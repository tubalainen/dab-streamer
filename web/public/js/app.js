/**
 * DAB+ Radio Streamer — Application Entry Point
 *
 * Checks setup status on load:
 *   - If setup is not complete: show the setup wizard.
 *   - If setup is complete: show the radio player UI.
 */

import * as api from './api.js';
import { initWizard } from './wizard.js';
import { initPlayer, play, stop, getState, setStationName, setDls } from './player.js';
import { initChannelList, loadChannels, setActiveStation } from './channels.js';
import { initNowPlaying, update as updateNowPlaying, clear as clearNowPlaying, onDlsChange } from './nowplaying.js';

const appEl = document.getElementById('app');

// Current radio state
let setupData = null;
let channelData = [];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const status = await api.getSetupStatus();
        if (status && status.completed) {
            setupData = status;
            initRadioMode();
        } else {
            initSetupMode();
        }
    } catch (err) {
        // If we get a 404 or error, assume setup not done
        if (err.status === 404 || err.status === 500) {
            initSetupMode();
        } else {
            showFatalError(`Failed to connect to API: ${err.message}`);
        }
    }
});

// ─── Setup Mode ─────────────────────────────────────────

function initSetupMode() {
    appEl.innerHTML = '';
    initWizard(appEl, () => {
        // Setup complete — reload into radio mode
        window.location.reload();
    });
}

// ─── Radio Mode ─────────────────────────────────────────

function initRadioMode() {
    appEl.innerHTML = `
        <div class="radio-container">
            <header class="radio-header">
                <div class="radio-header-title">
                    <div class="header-icon">R</div>
                    <h1>DAB+ <span>Radio Streamer</span></h1>
                </div>
                <div class="radio-header-actions">
                    <button class="btn btn-sm btn-secondary" id="btn-settings" title="Settings">
                        &#9881;
                    </button>
                    <button class="btn btn-sm btn-secondary" id="btn-setup">
                        Reset Configuration
                    </button>
                </div>
            </header>

            <aside class="sidebar" id="sidebar-container">
            </aside>

            <div class="main-content">
                <div id="now-playing-container"></div>
            </div>

            <div class="player-controls" id="player-container"></div>

            <div class="settings-panel" id="settings-panel" style="display:none;">
                <div class="settings-overlay" id="settings-overlay"></div>
                <div class="settings-content">
                    <h3>RTL-SDR Settings</h3>
                    <div class="form-group">
                        <label for="gain-select">Gain</label>
                        <select id="gain-select" class="form-control">
                            <option value="-1">AGC (Automatic)</option>
                            <option value="0">0 dB</option>
                            <option value="1">0.9 dB</option>
                            <option value="2">1.4 dB</option>
                            <option value="3">2.7 dB</option>
                            <option value="4">3.7 dB</option>
                            <option value="5">7.7 dB</option>
                            <option value="6">8.7 dB</option>
                            <option value="7">12.5 dB</option>
                            <option value="8">14.4 dB</option>
                            <option value="9">15.7 dB</option>
                            <option value="10">16.6 dB</option>
                            <option value="11">19.7 dB</option>
                            <option value="12">20.7 dB</option>
                            <option value="13">22.9 dB</option>
                            <option value="14">25.4 dB</option>
                            <option value="15">28.0 dB</option>
                            <option value="16">29.7 dB</option>
                            <option value="17">32.8 dB</option>
                            <option value="18">33.8 dB</option>
                            <option value="19">36.4 dB</option>
                            <option value="20">37.2 dB</option>
                            <option value="21">38.6 dB</option>
                            <option value="22">40.2 dB</option>
                            <option value="23">42.1 dB</option>
                            <option value="24">43.4 dB</option>
                            <option value="25">43.9 dB</option>
                            <option value="26">44.5 dB</option>
                            <option value="27">48.0 dB</option>
                            <option value="28">49.6 dB</option>
                        </select>
                        <small class="form-text">
                            AGC lets the dongle automatically adjust gain.
                            Manual gain values may improve reception in strong/weak signal areas.
                        </small>
                    </div>
                    <div class="settings-actions">
                        <button class="btn btn-primary btn-sm" id="btn-save-settings">Save</button>
                        <button class="btn btn-secondary btn-sm" id="btn-close-settings">Close</button>
                    </div>
                </div>
            </div>

            <div class="confirm-modal" id="reset-modal" style="display:none;">
                <div class="confirm-overlay" id="reset-overlay"></div>
                <div class="confirm-content">
                    <h3>Reset Configuration</h3>
                    <p>This will stop playback, release all device locks, and return to the setup wizard. Your scan data will be preserved.</p>
                    <p class="text-muted" style="font-size: 13px;">Are you sure you want to continue?</p>
                    <div class="confirm-actions">
                        <button class="btn btn-secondary btn-sm" id="btn-reset-cancel">Cancel</button>
                        <button class="btn btn-danger btn-sm" id="btn-reset-confirm">Reset</button>
                    </div>
                </div>
            </div>

            <footer class="status-bar">
                <div class="status-bar-left">
                    <div class="status-bar-item">
                        <span class="status-dot" id="status-dot"></span>
                        <span id="status-text">Connected</span>
                    </div>
                </div>
                <div class="status-bar-right">
                    <div class="status-bar-item" id="status-device"></div>
                    <div class="status-bar-item">DAB+ Radio Streamer</div>
                </div>
            </footer>
        </div>
    `;

    // Initialize components
    const sidebarEl = document.getElementById('sidebar-container');
    const nowPlayingEl = document.getElementById('now-playing-container');
    const playerEl = document.getElementById('player-container');

    initPlayer(playerEl);
    initNowPlaying(nowPlayingEl);
    initChannelList(sidebarEl, onStationSelect);

    // Wire DLS updates from now-playing to player bar
    onDlsChange((dlsText) => setDls(dlsText));

    // Reset Configuration button — show confirmation modal
    document.getElementById('btn-setup').addEventListener('click', () => {
        document.getElementById('reset-modal').style.display = 'flex';
    });

    document.getElementById('reset-overlay').addEventListener('click', () => {
        document.getElementById('reset-modal').style.display = 'none';
    });

    document.getElementById('btn-reset-cancel').addEventListener('click', () => {
        document.getElementById('reset-modal').style.display = 'none';
    });

    document.getElementById('btn-reset-confirm').addEventListener('click', async () => {
        const confirmBtn = document.getElementById('btn-reset-confirm');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner spinner-sm spinner-inline"></span> Resetting...';
        stop();
        try {
            await api.resetSetup();
            window.location.reload();
        } catch (err) {
            document.getElementById('reset-modal').style.display = 'none';
            alert(`Failed to reset setup: ${err.message}`);
        }
    });

    // Settings panel
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('settings-overlay').addEventListener('click', closeSettings);
    document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

    // Load channel data
    loadRadioData();

    // Start status polling
    startStatusPolling();
}

async function loadRadioData() {
    try {
        const deviceIndex = setupData.selected_device ? setupData.selected_device.index : 0;

        // Load channels for the configured device
        const result = await api.getChannelsForDevice(deviceIndex);
        channelData = result.transponders || result.channels || result || [];

        const activeChannel = setupData.selected_transponder
            ? setupData.selected_transponder.channel
            : null;
        loadChannels(channelData, activeChannel);

        // Update status bar with device info
        const deviceEl = document.getElementById('status-device');
        const deviceSerial = setupData.selected_device ? setupData.selected_device.serial : null;
        if (deviceEl && deviceSerial) {
            deviceEl.textContent = `Device: ${deviceSerial}`;
        }

        // Try to load current playback state
        try {
            const current = await api.getCurrentInfo();
            if (current && current.service) {
                onStationInfoLoaded(current);
            }
        } catch {
            // No current playback, that is fine
        }
    } catch (err) {
        console.error('Failed to load radio data:', err);
    }
}

function onStationSelect(sid, stationName, transponder) {
    // Update now-playing
    const ensembleLabel = transponder ? getEnsembleLabel(transponder) : null;
    const deviceSerial = setupData && setupData.selected_device ? setupData.selected_device.serial : null;
    const deviceIndex = setupData && setupData.selected_device ? setupData.selected_device.index : 0;

    updateNowPlaying({
        sid: sid,
        stationName: stationName,
        ensemble: ensembleLabel || (transponder ? transponder.channel : null),
        channel: transponder ? transponder.channel : null,
        bitrate: findServiceBitrate(sid, transponder),
        codec: findServiceCodec(sid, transponder),
        deviceName: deviceSerial || `Device #${deviceIndex}`,
    });

    // Update active station in sidebar
    setActiveStation(sid);

    // Start playback
    play(sid, stationName);
}

function onStationInfoLoaded(info) {
    // Reconstruct state from API current info
    if (info.service) {
        const sid = info.service.sid || info.service.id;
        const name = info.service.name || `Service ${sid}`;

        updateNowPlaying({
            sid: sid,
            stationName: name,
            ensemble: info.ensemble || info.channel,
            channel: info.channel,
            bitrate: info.service.bitrate,
            codec: info.service.codec,
            deviceName: setupData && setupData.selected_device ? (setupData.selected_device.serial || null) : null,
        });

        setActiveStation(sid);
        setStationName(name);
    }
}

function findServiceBitrate(sid, transponder) {
    if (!transponder || !transponder.services) return null;
    const svc = transponder.services.find(s => String(s.sid) === String(sid));
    return svc ? svc.bitrate : null;
}

function findServiceCodec(sid, transponder) {
    if (!transponder || !transponder.services) return null;
    const svc = transponder.services.find(s => String(s.sid) === String(sid));
    return svc ? svc.codec : null;
}

// ─── Status Polling ─────────────────────────────────────

let statusPollTimer = null;

function startStatusPolling() {
    // Poll every 30 seconds
    statusPollTimer = setInterval(async () => {
        try {
            await api.getStatus();
            updateStatusIndicator(true);
        } catch {
            updateStatusIndicator(false);
        }
    }, 30000);
}

function updateStatusIndicator(connected) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (dot) {
        dot.className = connected ? 'status-dot' : 'status-dot offline';
    }
    if (text) {
        text.textContent = connected ? 'Connected' : 'Disconnected';
    }
}

// ─── Settings Panel ─────────────────────────────────────

async function openSettings() {
    const panel = document.getElementById('settings-panel');
    panel.style.display = 'flex';

    // Load current settings from server
    try {
        const settings = await api.getSettings();
        if (settings && settings.gain !== undefined) {
            document.getElementById('gain-select').value = String(settings.gain);
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

function closeSettings() {
    document.getElementById('settings-panel').style.display = 'none';
}

async function saveSettings() {
    const gain = parseInt(document.getElementById('gain-select').value, 10);

    try {
        await api.updateSettings({ gain });
        closeSettings();

        // If currently streaming, the user will need to re-tune for the gain change to take effect
        const playerState = getState();
        if (playerState && playerState.playing) {
            const proceed = confirm(
                'Gain setting saved. A re-tune is needed for the change to take effect. Re-tune now?'
            );
            if (proceed) {
                const deviceIndex = setupData.selected_device ? setupData.selected_device.index : 0;
                const channel = setupData.selected_transponder
                    ? setupData.selected_transponder.channel
                    : null;
                if (channel) {
                    await api.tune(deviceIndex, channel);
                }
            }
        }
    } catch (err) {
        alert(`Failed to save settings: ${err.message}`);
    }
}

// ─── Fatal Error ────────────────────────────────────────

function showFatalError(message) {
    appEl.innerHTML = `
        <div class="wizard-container" style="justify-content: center; align-items: center;">
            <div class="error-message" style="max-width: 500px;">
                <div>
                    <strong>Connection Error</strong><br>
                    ${escapeHtml(message)}<br><br>
                    <button class="btn btn-primary btn-sm" onclick="window.location.reload()">Retry</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Safely extract a label string from a welle-cli label field.
 */
function extractLabel(val) {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && typeof val.label === 'string') return val.label;
    if (typeof val === 'object' && val.label) return extractLabel(val.label);
    return null;
}

/**
 * Safely extract the ensemble label from a transponder object.
 */
function getEnsembleLabel(tp) {
    if (!tp) return 'Unknown';
    const e = tp.ensemble;
    if (!e) return tp.channel || 'Unknown';
    if (typeof e === 'string') return e;
    if (typeof e === 'object') {
        const label = extractLabel(e.label);
        if (label) return label;
    }
    return tp.channel || 'Unknown';
}

function escapeHtml(str) {
    if (!str) return '';
    if (typeof str !== 'string') str = String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
