/**
 * DAB+ Radio Streamer — Now Playing Panel
 */

let containerEl = null;
let currentInfo = null;

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
 * Update the now-playing display with new info.
 * @param {Object} info - Station info object
 *   { sid, stationName, ensemble, channel, bitrate, codec, deviceIndex, deviceName }
 */
export function update(info) {
    currentInfo = info;
    render();
}

/**
 * Clear the now-playing display.
 */
export function clear() {
    currentInfo = null;
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
 * Attempt to load the station logo from welle-cli's MOT/slideshow endpoint.
 * Falls back to the SVG radio icon if no logo is available.
 */
function loadLogo(sid) {
    const logoEl = document.getElementById('now-playing-logo');
    if (!logoEl) return;

    const img = new Image();
    img.onload = () => {
        logoEl.innerHTML = '';
        img.className = 'now-playing-logo-img';
        img.alt = 'Station logo';
        logoEl.appendChild(img);
    };
    img.onerror = () => {
        // Keep the fallback SVG icon
    };
    // Cache-bust to get fresh logo on station change
    img.src = `/slide/${sid}?t=${Date.now()}`;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
