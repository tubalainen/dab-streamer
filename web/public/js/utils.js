/**
 * DAB+ Radio Streamer — Shared Utility Functions
 */

/**
 * Escape HTML entities for safe insertion into innerHTML.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    if (typeof str !== 'string') str = String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Escape a string for safe use in HTML attributes.
 * @param {string} str
 * @returns {string}
 */
export function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Safely extract a label string from a welle-cli label field.
 * welle-cli can return labels as:
 *   - a plain string: "Name"
 *   - a nested object: { label: "Name", shortlabel: "N", ... }
 * @param {*} val
 * @returns {string|null}
 */
export function extractLabel(val) {
    if (!val) return null;
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && typeof val.label === 'string') return val.label;
    if (typeof val === 'object' && val.label) return extractLabel(val.label);
    return null;
}

/**
 * Safely extract the ensemble label from a transponder object.
 * Handles all forms: ensemble as string, object with label string,
 * or object with nested label object (raw welle-cli format).
 * @param {Object} tp - Transponder object
 * @returns {string}
 */
export function getEnsembleLabel(tp) {
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

/**
 * Filter services to only include audio services.
 * welle-cli uses lowercase: "audio", "streamdata", "packetdata", "fidc".
 * If transportmode is missing (old scan data), assume audio.
 * @param {Array} services
 * @returns {Array}
 */
export function filterAudioServices(services) {
    if (!services) return [];
    return services.filter(svc => {
        if (svc.transportmode && svc.transportmode !== 'audio') return false;
        return true;
    });
}
