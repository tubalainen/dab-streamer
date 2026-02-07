/**
 * DAB+ Radio Streamer — Scan Progress UI Helper
 */

/**
 * Render the scan progress display.
 * @param {HTMLElement} container - Container to render into
 * @param {Object} progress - Scan progress object from API
 *   { status, channels_scanned, channels_total, current_channel, transponders }
 */
export function renderScanProgress(container, progress) {
    const scanned = progress.channels_scanned || 0;
    const total = progress.channels_total || 1;
    const percent = Math.round((scanned / total) * 100);
    const transponders = progress.transponders || [];
    const totalServices = transponders.reduce((sum, t) => sum + (t.services ? t.services.length : 0), 0);

    container.innerHTML = `
        <div class="scan-progress">
            <div class="scan-progress-header">
                <div class="scan-progress-percent">${percent}%</div>
                <div class="scan-progress-channel">
                    ${progress.current_channel ? `Scanning: ${escapeHtml(progress.current_channel)}` : 'Preparing...'}
                </div>
            </div>

            <div class="progress-bar progress-bar-lg">
                <div class="progress-fill" style="width: ${percent}%"></div>
            </div>

            <div class="scan-stats">
                <div class="scan-stat">
                    <div class="scan-stat-value">${scanned}</div>
                    <div class="scan-stat-label">Channels Scanned</div>
                </div>
                <div class="scan-stat">
                    <div class="scan-stat-value">${transponders.length}</div>
                    <div class="scan-stat-label">Transponders</div>
                </div>
                <div class="scan-stat">
                    <div class="scan-stat-value">${totalServices}</div>
                    <div class="scan-stat-label">Services</div>
                </div>
            </div>

            ${transponders.length > 0 ? `
            <div class="scan-transponders">
                <h4>Discovered Transponders</h4>
                ${transponders.map(t => `
                    <div class="scan-transponder-item">
                        <span class="channel-name">${escapeHtml(getEnsembleLabel(t))}</span>
                        <span class="service-count">${t.services ? t.services.length : 0} services</span>
                    </div>
                `).join('')}
            </div>` : ''}
        </div>
    `;
}

/**
 * Render the scan complete summary.
 * @param {HTMLElement} container - Container to render into
 * @param {number} transponderCount - Number of transponders found
 * @param {number} serviceCount - Number of services found
 */
export function renderScanComplete(container, transponderCount, serviceCount) {
    container.innerHTML = `
        <div class="scan-progress">
            <div class="scan-progress-header">
                <div class="scan-progress-percent">100%</div>
                <div class="scan-progress-channel">Scan complete</div>
            </div>

            <div class="progress-bar progress-bar-lg">
                <div class="progress-fill complete" style="width: 100%"></div>
            </div>

            <div class="scan-stats">
                <div class="scan-stat">
                    <div class="scan-stat-value" style="color: var(--accent-green)">${transponderCount}</div>
                    <div class="scan-stat-label">Transponders Found</div>
                </div>
                <div class="scan-stat">
                    <div class="scan-stat-value" style="color: var(--accent-green)">${serviceCount}</div>
                    <div class="scan-stat-label">Services Found</div>
                </div>
                <div class="scan-stat">
                    <div class="scan-stat-value" style="color: var(--accent-green)">&#10003;</div>
                    <div class="scan-stat-label">Complete</div>
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
