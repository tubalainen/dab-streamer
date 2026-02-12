/**
 * DAB+ Radio Streamer — Application Entry Point
 *
 * Checks setup status on load:
 *   - If setup is not complete: show the setup wizard.
 *   - If setup is complete: show the radio player UI.
 */

import * as api from './api.js';
import { escapeHtml, getEnsembleLabel } from './utils.js';
import { initWizard } from './wizard.js';
import { initPlayer, play, stop, setStationName, setDls } from './player.js';
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

            <div class="confirm-modal" id="reset-modal" style="display:none;">
                <div class="confirm-overlay" id="reset-overlay"></div>
                <div class="confirm-content">
                    <h3>Reset Configuration</h3>
                    <p>This will stop playback, erase all stored data (except station logos), re-detect RTL-SDR devices, and restart the setup wizard from scratch.</p>
                    <div class="form-group">
                        <label for="reset-password">Admin Password</label>
                        <input type="password" id="reset-password" class="form-control" placeholder="Enter admin password">
                        <div id="reset-password-error" style="display:none; color: var(--accent-red); font-size: 13px; margin-top: 4px;"></div>
                    </div>
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
                    <div class="status-bar-item"><a href="https://github.com/tubalainen/dab-streamer" target="_blank" rel="noopener noreferrer">DAB+ Radio Streamer</a></div>
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

    // Reset Configuration button — show modal with password prompt
    document.getElementById('btn-setup').addEventListener('click', () => {
        document.getElementById('reset-password').value = '';
        document.getElementById('reset-password-error').style.display = 'none';
        document.getElementById('reset-modal').style.display = 'flex';
        document.getElementById('reset-password').focus();
    });

    document.getElementById('reset-overlay').addEventListener('click', closeResetModal);
    document.getElementById('btn-reset-cancel').addEventListener('click', closeResetModal);

    document.getElementById('btn-reset-confirm').addEventListener('click', async () => {
        const confirmBtn = document.getElementById('btn-reset-confirm');
        const password = document.getElementById('reset-password').value;
        const errorEl = document.getElementById('reset-password-error');
        errorEl.style.display = 'none';

        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner spinner-sm spinner-inline"></span> Resetting...';
        stop();
        try {
            await api.resetSetup(password);
            window.location.reload();
        } catch (err) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Reset';
            if (err.status === 401) {
                errorEl.textContent = 'Incorrect password';
                errorEl.style.display = 'block';
            } else {
                errorEl.textContent = `Failed to reset: ${err.message}`;
                errorEl.style.display = 'block';
            }
        }
    });

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

// ─── Reset Modal ───────────────────────────────────────

function closeResetModal() {
    document.getElementById('reset-password').value = '';
    document.getElementById('reset-password-error').style.display = 'none';
    document.getElementById('reset-modal').style.display = 'none';
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

