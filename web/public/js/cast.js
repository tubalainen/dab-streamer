/**
 * DAB+ Radio Streamer — Google Cast Module
 *
 * Manages Chromecast discovery, session lifecycle, and remote media playback.
 * Uses the Default Media Receiver — no custom receiver app required.
 */

let remotePlayer = null;
let remotePlayerController = null;
let castAvailable = false;
let sessionCallback = null; // (connected: boolean, deviceName: string|null) => void

/**
 * Initialize the Google Cast SDK.
 * Must be called early — the SDK loads asynchronously and needs
 * the __onGCastApiAvailable callback registered before it fires.
 *
 * @param {Function} onSessionChange - (connected: boolean, deviceName: string|null) => void
 */
export function initCast(onSessionChange) {
    sessionCallback = onSessionChange;

    window['__onGCastApiAvailable'] = function (isAvailable) {
        if (!isAvailable) {
            console.log('[cast] Cast SDK not available');
            return;
        }

        const context = cast.framework.CastContext.getInstance();
        context.setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        remotePlayer = new cast.framework.RemotePlayer();
        remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);

        // Track device availability
        context.addEventListener(
            cast.framework.CastContextEventType.CAST_STATE_CHANGED,
            (event) => {
                castAvailable = event.castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
            }
        );

        // Track session connect/disconnect
        context.addEventListener(
            cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
            (event) => {
                const state = event.sessionState;
                if (state === cast.framework.SessionState.SESSION_STARTED ||
                    state === cast.framework.SessionState.SESSION_RESUMED) {
                    const name = getDeviceName();
                    console.log(`[cast] Session started — casting to "${name}"`);
                    if (sessionCallback) sessionCallback(true, name);
                } else if (state === cast.framework.SessionState.SESSION_ENDED) {
                    console.log('[cast] Session ended');
                    if (sessionCallback) sessionCallback(false, null);
                }
            }
        );

        // Listen for remote player connection changes (covers edge cases)
        remotePlayerController.addEventListener(
            cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
            () => {
                if (!remotePlayer.isConnected) {
                    if (sessionCallback) sessionCallback(false, null);
                }
            }
        );

        console.log('[cast] Cast SDK initialized');
    };
}

/**
 * Check if the browser is currently casting.
 * @returns {boolean}
 */
export function isCasting() {
    return remotePlayer !== null && remotePlayer.isConnected;
}

/**
 * Check if any Cast devices are available on the network.
 * @returns {boolean}
 */
export function isCastAvailable() {
    return castAvailable;
}

/**
 * Get the friendly name of the connected Cast device.
 * @returns {string|null}
 */
export function getDeviceName() {
    try {
        const session = cast.framework.CastContext.getInstance().getCurrentSession();
        if (session) {
            return session.getCastDevice().friendlyName;
        }
    } catch {
        // SDK not loaded or no session
    }
    return null;
}

/**
 * Load a live audio stream on the connected Chromecast.
 *
 * @param {string} sid - Service ID
 * @param {string} stationName - Display name for the station
 * @param {string|null} logoUrl - Absolute URL to station logo (or null)
 * @returns {Promise}
 */
export function castStream(sid, stationName, logoUrl) {
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    if (!session) {
        return Promise.reject(new Error('No active Cast session'));
    }

    // Build absolute stream URL so the Chromecast device can reach it
    const streamUrl = `${window.location.origin}/stream/${sid}`;

    const mediaInfo = new chrome.cast.media.MediaInfo(streamUrl, 'audio/mpeg');
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    mediaInfo.duration = null;

    // Attach station metadata
    const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
    metadata.title = stationName || `Service ${sid}`;
    metadata.artist = 'DAB+ Radio';
    if (logoUrl) {
        metadata.images = [new chrome.cast.Image(logoUrl)];
    }
    mediaInfo.metadata = metadata;

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;

    console.log(`[cast] Loading stream: ${stationName} (${streamUrl})`);
    return session.loadMedia(request);
}

/**
 * Stop media playback on the Cast device (does not end the session).
 */
export function stopCastMedia() {
    if (remotePlayerController && remotePlayer && remotePlayer.isConnected) {
        remotePlayerController.stop();
    }
}

/**
 * End the Cast session entirely.
 */
export function endCastSession() {
    try {
        const session = cast.framework.CastContext.getInstance().getCurrentSession();
        if (session) {
            session.endSession(true);
        }
    } catch {
        // SDK not loaded or no session
    }
}

/**
 * Set volume on the Cast device.
 * @param {number} level - 0.0 to 1.0
 */
export function setCastVolume(level) {
    if (remotePlayer && remotePlayerController && remotePlayer.isConnected) {
        remotePlayer.volumeLevel = Math.max(0, Math.min(1, level));
        remotePlayerController.setVolumeLevel();
    }
}

/**
 * Get the current Cast player state.
 * @returns {string|null} 'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING' | null
 */
export function getCastPlayerState() {
    if (remotePlayer && remotePlayer.isConnected) {
        return remotePlayer.playerState;
    }
    return null;
}
