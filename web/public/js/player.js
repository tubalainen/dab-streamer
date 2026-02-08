/**
 * DAB+ Radio Streamer — Audio Player Controller
 */

let audioEl = null;
let containerEl = null;
let state = 'stopped'; // 'stopped' | 'loading' | 'playing' | 'error'
let currentSid = null;
let currentStationName = null;
let currentVolume = 0.6;
let currentDlsText = '';
let sliderActive = false; // true while user is dragging the volume slider

// SVG icons
const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`;
const ICON_VOLUME = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
const ICON_VOLUME_MUTE = `<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;

/**
 * Initialize the player UI in the given container.
 * @param {HTMLElement} container
 */
export function initPlayer(container) {
    containerEl = container;

    // Create hidden audio element
    audioEl = document.createElement('audio');
    audioEl.preload = 'auto';
    audioEl.volume = currentVolume;

    audioEl.addEventListener('playing', () => {
        state = 'playing';
        render();
    });

    audioEl.addEventListener('waiting', () => {
        state = 'loading';
        render();
    });

    audioEl.addEventListener('pause', () => {
        if (!audioEl.ended) {
            state = 'stopped';
            render();
        }
    });

    audioEl.addEventListener('ended', () => {
        state = 'stopped';
        currentSid = null;
        render();
    });

    audioEl.addEventListener('error', () => {
        state = 'error';
        render();
    });

    document.body.appendChild(audioEl);
    render();
}

/**
 * Start playing a stream for the given service ID.
 * Waits for the browser to buffer enough data before starting playback.
 * @param {string|number} sid - Service ID
 * @param {string|null} stationName - Display name for the station
 */
export function play(sid, stationName = null) {
    if (!audioEl) return;

    currentSid = sid;
    currentStationName = stationName;
    state = 'loading';
    audioEl.src = `/stream/${sid}`;
    audioEl.load();
    render();

    // Wait for sufficient buffer before starting playback
    let started = false;
    const startPlayback = () => {
        if (started) return;
        started = true;
        audioEl.removeEventListener('canplaythrough', bufferHandler);
        clearTimeout(bufferTimeout);
        audioEl.play().catch(() => {
            state = 'error';
            render();
        });
    };

    // Start when browser signals enough data is buffered
    const bufferHandler = () => startPlayback();
    audioEl.addEventListener('canplaythrough', bufferHandler);

    // Fallback: start after 2 seconds even if canplaythrough hasn't fired (common for live streams)
    const bufferTimeout = setTimeout(() => startPlayback(), 2000);
}

/**
 * Stop playback.
 */
export function stop() {
    if (!audioEl) return;

    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    state = 'stopped';
    currentSid = null;
    currentStationName = null;
    currentDlsText = '';
    render();
}

/**
 * Set volume level.
 * @param {number} level - Volume from 0.0 to 1.0
 * @param {boolean} skipRender - If true, skip full re-render (used during slider drag)
 */
export function setVolume(level, skipRender = false) {
    currentVolume = Math.max(0, Math.min(1, level));
    if (audioEl) {
        audioEl.volume = currentVolume;
    }
    if (skipRender) {
        // Update mute icon without destroying the slider
        const iconEl = containerEl && containerEl.querySelector('.player-volume-icon');
        if (iconEl) {
            iconEl.innerHTML = currentVolume === 0 ? ICON_VOLUME_MUTE : ICON_VOLUME;
        }
    } else {
        render();
    }
}

/**
 * Set the station name (e.g. when recovering playback state on page load).
 * @param {string} name - Station display name
 */
export function setStationName(name) {
    currentStationName = name;
    render();
}

/**
 * Set the DLS (Dynamic Label Segment) text for the player bar.
 * Updates the status line in-place without a full re-render to preserve volume slider state.
 * @param {string} text - DLS text (empty string to clear)
 */
export function setDls(text) {
    currentDlsText = text || '';
    // Update status text in-place if playing (avoid destroying slider)
    const statusEl = containerEl && containerEl.querySelector('.player-info-status');
    if (statusEl && state === 'playing') {
        statusEl.textContent = currentDlsText || 'Playing';
    }
}

/**
 * Get the current player state.
 * @returns {{ state: string, sid: string|null, volume: number, stationName: string|null }}
 */
export function getState() {
    return {
        state,
        sid: currentSid,
        volume: currentVolume,
        stationName: currentStationName,
    };
}

/**
 * Render the player controls.
 */
function render() {
    if (!containerEl) return;
    if (sliderActive) return; // Don't destroy slider mid-drag

    const isPlaying = state === 'playing';
    const isLoading = state === 'loading';
    const isMuted = currentVolume === 0;

    containerEl.innerHTML = `
        <button class="player-play-btn" ${!currentSid && state === 'stopped' ? 'disabled' : ''}>
            ${isPlaying ? ICON_STOP : ICON_PLAY}
        </button>
        <div class="player-info">
            <div class="player-info-station">${currentStationName || (currentSid ? `Service ${currentSid}` : 'No station selected')}</div>
            <div class="player-info-status ${state}">
                ${isLoading ? '<span class="spinner spinner-sm spinner-inline"></span> Buffering...' : ''}
                ${isPlaying ? (currentDlsText || 'Playing') : ''}
                ${state === 'stopped' ? (currentSid ? 'Stopped' : 'Select a station') : ''}
                ${state === 'error' ? 'Stream error' : ''}
            </div>
        </div>
        <div class="player-volume">
            <div class="player-volume-icon">${isMuted ? ICON_VOLUME_MUTE : ICON_VOLUME}</div>
            <input type="range" class="player-volume-slider" min="0" max="100" value="${Math.round(currentVolume * 100)}">
        </div>
    `;

    // Play/stop button
    const playBtn = containerEl.querySelector('.player-play-btn');
    playBtn.addEventListener('click', () => {
        if (isPlaying || isLoading) {
            stop();
        } else if (currentSid) {
            play(currentSid);
        }
    });

    // Volume slider — use skipRender to avoid destroying the slider during drag
    const volumeSlider = containerEl.querySelector('.player-volume-slider');
    volumeSlider.addEventListener('input', (e) => {
        setVolume(parseInt(e.target.value, 10) / 100, true);
    });
    volumeSlider.addEventListener('mousedown', () => { sliderActive = true; });
    volumeSlider.addEventListener('touchstart', () => { sliderActive = true; });
    const releaseSlider = () => { sliderActive = false; };
    volumeSlider.addEventListener('mouseup', releaseSlider);
    volumeSlider.addEventListener('touchend', releaseSlider);
    // Also release if mouse leaves the slider area entirely
    window.addEventListener('mouseup', releaseSlider, { once: false });

    // Mute toggle — full render needed to update slider position
    const volumeIcon = containerEl.querySelector('.player-volume-icon');
    let volumeBeforeMute = currentVolume || 0.6;
    volumeIcon.addEventListener('click', () => {
        if (currentVolume > 0) {
            volumeBeforeMute = currentVolume;
            setVolume(0);
        } else {
            setVolume(volumeBeforeMute);
        }
    });
}
