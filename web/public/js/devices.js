/**
 * DAB+ Radio Streamer — Device Rendering Helpers
 */

/**
 * Render a list of selectable device cards.
 * @param {Array} devices - Array of device objects
 * @param {number|null} selectedIndex - Currently selected device index
 * @param {Function} onSelect - Callback when a device is selected
 * @returns {HTMLElement} Container element with device cards
 */
export function renderDeviceCards(devices, selectedIndex, onSelect) {
    const container = document.createElement('div');
    container.className = 'device-cards';

    devices.forEach((device) => {
        const card = document.createElement('div');
        card.className = 'device-card clickable';
        if (device.index === selectedIndex) {
            card.classList.add('selected');
        }

        card.innerHTML = `
            <div class="device-card-radio"></div>
            <div class="device-card-info">
                <div class="device-card-name">${escapeHtml(device.name || device.product || `RTL-SDR Device`)}</div>
                <div class="device-card-detail">
                    Serial: ${escapeHtml(device.serial || 'N/A')}
                    ${device.product ? ` &middot; ${escapeHtml(device.product)}` : ''}
                </div>
            </div>
            <div class="device-card-index">#${device.index}</div>
        `;

        card.addEventListener('click', () => {
            onSelect(device);
        });

        container.appendChild(card);
    });

    return container;
}

/**
 * Render device info summary (used in status displays).
 * @param {Object} device - Device object
 * @returns {HTMLElement} Device info element
 */
export function renderDeviceInfo(device) {
    const el = document.createElement('div');
    el.className = 'device-info';

    el.innerHTML = `
        <div class="device-info-row">
            <span class="device-info-label">Device</span>
            <span class="device-info-value">${escapeHtml(device.name || device.product || 'RTL-SDR')}</span>
        </div>
        ${device.serial ? `
        <div class="device-info-row">
            <span class="device-info-label">Serial</span>
            <span class="device-info-value text-mono">${escapeHtml(device.serial)}</span>
        </div>` : ''}
        <div class="device-info-row">
            <span class="device-info-label">Index</span>
            <span class="device-info-value text-mono">#${device.index}</span>
        </div>
    `;

    return el;
}

/**
 * Escape HTML entities for safe insertion.
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
