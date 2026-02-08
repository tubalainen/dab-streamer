/**
 * DAB+ Radio Streamer — Now Playing Panel
 */

import { getCachedLogo, fetchAndCacheLogo, retryLogo, refreshLogo } from './logo-cache.js';
import { getDLS } from './api.js';

let containerEl = null;
let currentInfo = null;

// DLS polling state
let dlsInterval = null;
let currentDlsText = '';
let lastDlsChange = 0;
let lastMotChange = 0;
let dlsCallback = null; // callback to notify app.js of DLS changes

// SVG fallback icon for when no station logo is available
const FALLBACK_RADIO_ICON = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="20" width="56" height="38" rx="6" stroke="currentColor" stroke-width="3"/>
    <circle cx="24" cy="39" r="10" stroke="currentColor" stroke-width="3"/>
    <rect x="40" y="30" width="14" height="3" rx="1.5" fill="currentColor"/>
    <rect x="40" y="36" width="14" height="3" rx="1.5" fill="currentColor"/>
    <rect x="40" y="42" width="14" height="3" rx="1.5" fill="currentColor"/>
    <line x1="20" y1="8" x2="34" y2="20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/**
 * Initialize the now-playing panel.
 * @param {HTMLElement} container
 */
export function initNowPlaying(container) {
    containerEl = container;
    render();
}

/**
 * Set a callback that fires whenever DLS text changes.
 * Used by app.js to relay DLS to the player bar.
 * @param {Function} cb - (dlsText: string) => void
 */
export function onDlsChange(cb) {
    dlsCallback = cb;
}

/**
 * Update the now-playing display with new info.
 * @param {Object} info - Station info object
 *   { sid, stationName, ensemble, channel, bitrate, codec, deviceIndex, deviceName }
 */
export function update(info) {
    const sidChanged = !currentInfo || String(currentInfo.sid) !== String(info.sid);
    currentInfo = info;
    render();

    if (sidChanged) {
        // Reset DLS and MOT state and restart polling for new station
        currentDlsText = '';
        lastDlsChange = 0;
        lastMotChange = 0;
        startDlsPolling(info.sid);
    }
}

/**
 * Clear the now-playing display.
 */
export function clear() {
    currentInfo = null;
    currentDlsText = '';
    lastDlsChange = 0;
    lastMotChange = 0;
    stopDlsPolling();
    if (dlsCallback) dlsCallback('');
    render();
}

function render() {
    if (!containerEl) return;

    if (!currentInfo) {
        containerEl.innerHTML = `
            <div class="now-playing">
                <div class="now-playing-empty">
                    <p>No station playing</p>
                    <p class="subtitle">Select a station from the sidebar to start listening</p>
                </div>
            </div>
        `;
        return;
    }

    const info = currentInfo;

    containerEl.innerHTML = `
        <div class="now-playing">
            <div class="now-playing-logo" id="now-playing-logo">
                <div class="now-playing-logo-fallback">${FALLBACK_RADIO_ICON}</div>
            </div>
            <div class="now-playing-label">Now Playing</div>
            <div class="now-playing-station">${escapeHtml(info.stationName || 'Unknown Station')}</div>
            <div class="now-playing-dls" id="now-playing-dls">${escapeHtml(currentDlsText)}</div>
            ${info.ensemble ? `<div class="now-playing-ensemble">${escapeHtml(info.ensemble)}</div>` : ''}
            <div class="now-playing-meta">
                ${info.channel ? `
                <div class="now-playing-meta-item">
                    <span class="now-playing-meta-label">Channel</span>
                    <span class="now-playing-meta-value">${escapeHtml(info.channel)}</span>
                </div>` : ''}
                ${info.bitrate ? `
                <div class="now-playing-meta-item">
                    <span class="now-playing-meta-label">Bitrate</span>
                    <span class="now-playing-meta-value">${info.bitrate} kbps</span>
                </div>` : ''}
                ${info.codec ? `
                <div class="now-playing-meta-item">
                    <span class="now-playing-meta-label">Codec</span>
                    <span class="now-playing-meta-value">${escapeHtml(info.codec)}</span>
                </div>` : ''}
                ${info.deviceName ? `
                <div class="now-playing-meta-item">
                    <span class="now-playing-meta-label">Device</span>
                    <span class="now-playing-meta-value">${escapeHtml(info.deviceName)}</span>
                </div>` : ''}
            </div>
        </div>
    `;

    // Try to load station logo
    if (info.sid) {
        loadLogo(info.sid);
    }
}

/**
 * Load the station logo, using the shared cache for instant display.
 * Falls back to the SVG radio icon if no logo is available.
 */
async function loadLogo(sid) {
    const logoEl = document.getElementById('now-playing-logo');
    if (!logoEl) return;

    // Check cache first for instant display
    const cached = getCachedLogo(sid);
    if (cached) {
        showLogoImage(logoEl, cached);
        return;
    }

    // Fetch and cache
    const blobUrl = await fetchAndCacheLogo(sid);
    if (blobUrl) {
        // Verify the element still exists and SID hasn't changed
        const el = document.getElementById('now-playing-logo');
        if (el && currentInfo && String(currentInfo.sid) === String(sid)) {
            showLogoImage(el, blobUrl);
        }
    }
}

function showLogoImage(logoEl, src) {
    logoEl.innerHTML = '';
    const img = new Image();
    img.className = 'now-playing-logo-img';
    img.alt = 'Station logo';
    img.src = src;
    logoEl.appendChild(img);
}

/**
 * Update the now-playing logo and sidebar thumbnail with a new blob URL.
 */
function updateLogoEverywhere(sid, blobUrl) {
    if (!currentInfo || String(currentInfo.sid) !== String(sid)) return;

    // Update now-playing logo
    const logoEl = document.getElementById('now-playing-logo');
    if (logoEl) {
        showLogoImage(logoEl, blobUrl);
    }
    // Update sidebar thumbnail in-place
    const thumbEl = document.querySelector(`.station-item-thumb[data-thumb-sid="${sid}"]`);
    if (thumbEl) {
        thumbEl.innerHTML = `<img src="${blobUrl}" alt="" class="station-item-thumb-img">`;
    }
}

// ─── DLS Polling ────────────────────────────────────────

function startDlsPolling(sid) {
    stopDlsPolling();
    // Initial fetch after a short delay (give stream time to start)
    setTimeout(() => pollDls(sid), 1500);
    dlsInterval = setInterval(() => pollDls(sid), 3000);
}

function stopDlsPolling() {
    if (dlsInterval) {
        clearInterval(dlsInterval);
        dlsInterval = null;
    }
}

async function pollDls(sid) {
    // Stop polling if station changed or cleared
    if (!currentInfo || String(currentInfo.sid) !== String(sid)) {
        stopDlsPolling();
        return;
    }

    try {
        const data = await getDLS(sid);
        if (!data) return;

        // Only update DOM when the DLS content actually changed
        if (data.dlsLastChange !== lastDlsChange || data.dls !== currentDlsText) {
            lastDlsChange = data.dlsLastChange;
            currentDlsText = data.dls || '';
            updateDlsDisplay(currentDlsText);
            if (dlsCallback) dlsCallback(currentDlsText);
        }

        // Detect MOT (slideshow/logo) changes — refresh logo when station sends new image
        if (data.motLastChange && data.motLastChange !== lastMotChange) {
            const hadPreviousMot = lastMotChange !== 0;
            lastMotChange = data.motLastChange;

            if (hadPreviousMot) {
                // MOT changed while we're listening — invalidate cache and re-fetch
                const blobUrl = await refreshLogo(sid);
                if (blobUrl) {
                    updateLogoEverywhere(sid, blobUrl);
                }
            } else {
                // First MOT data received — fetch if not already cached
                if (!getCachedLogo(sid)) {
                    const blobUrl = await retryLogo(sid);
                    if (blobUrl) {
                        updateLogoEverywhere(sid, blobUrl);
                    }
                }
            }
            return; // Logo was handled via MOT detection, skip retry below
        }
    } catch {
        // DLS fetch failed — ignore silently, will retry on next poll
    }

    // Retry logo if not yet cached for the active station (no MOT data yet)
    if (!getCachedLogo(sid)) {
        const blobUrl = await retryLogo(sid);
        if (blobUrl) {
            updateLogoEverywhere(sid, blobUrl);
        }
    }
}

function updateDlsDisplay(text) {
    const el = document.getElementById('now-playing-dls');
    if (!el) return;

    // Fade out, update, fade in
    el.classList.add('fade');
    setTimeout(() => {
        el.textContent = text;
        el.classList.remove('fade');
    }, 200);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
