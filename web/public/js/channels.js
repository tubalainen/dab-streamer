/**
 * DAB+ Radio Streamer — Channel / Station List UI
 */

import { escapeHtml, escapeAttr, getEnsembleLabel, filterAudioServices } from './utils.js';
import { getCachedLogo, fetchAndCacheLogo } from './logo-cache.js';

// Simplified radio icon for station thumbnails
const FALLBACK_THUMB_ICON = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="20" width="56" height="38" rx="6" stroke="currentColor" stroke-width="4"/>
    <circle cx="24" cy="39" r="10" stroke="currentColor" stroke-width="4"/>
</svg>`;

let containerEl = null;
let selectCallback = null;
let currentTransponders = [];
let activeChannelName = null;
let activeSid = null;

/**
 * Initialize the channel list sidebar.
 * @param {HTMLElement} container - Sidebar container element
 * @param {Function} onStationSelect - Callback: (sid, stationName, transponder) => void
 */
export function initChannelList(container, onStationSelect) {
    containerEl = container;
    selectCallback = onStationSelect;
    render();
}

/**
 * Load channel data and render the list.
 * @param {Array} transponders - Array of transponder objects, each with services array
 * @param {string|null} activeChannel - Currently active channel/transponder name
 */
export function loadChannels(transponders, activeChannel) {
    currentTransponders = transponders || [];
    activeChannelName = activeChannel || null;
    render();
}

/**
 * Set the currently active station (highlight in the list).
 * @param {string|number} sid - Service ID
 */
export function setActiveStation(sid) {
    activeSid = sid;
    render();
}

/**
 * Render the channel list.
 */
function render() {
    if (!containerEl) return;

    if (currentTransponders.length === 0) {
        containerEl.innerHTML = `
            <div class="sidebar-section">
                <div class="sidebar-section-header">
                    <span class="sidebar-section-title">Stations</span>
                </div>
                <div style="padding: var(--space-6); text-align: center;">
                    <p class="text-muted">No channels loaded</p>
                </div>
            </div>
        `;
        return;
    }

    // Count total audio services (filter out non-audio like SPI, EPG, TPEG)
    const totalServices = currentTransponders.reduce(
        (sum, t) => sum + filterAudioServices(t.services).length, 0
    );

    let html = '';

    // Transponder list section
    html += `
        <div class="sidebar-section">
            <div class="sidebar-section-header">
                <span class="sidebar-section-title">Transponders</span>
                <span class="sidebar-section-count">${currentTransponders.length}</span>
            </div>
            <ul class="transponder-list">
    `;

    currentTransponders.forEach((tp) => {
        const ensembleLabel = getEnsembleLabel(tp);
        const isActive = tp.channel === activeChannelName || ensembleLabel === activeChannelName;
        html += `
            <li class="transponder-item ${isActive ? 'active' : ''}"
                data-channel="${escapeAttr(tp.channel || '')}">
                <span class="transponder-item-name">${escapeHtml(ensembleLabel)}</span>
                <span class="transponder-item-channel">${escapeHtml(tp.channel || '')}</span>
            </li>
        `;
    });

    html += `
            </ul>
        </div>
    `;

    // Station list section
    html += `
        <div class="sidebar-section">
            <div class="sidebar-section-header">
                <span class="sidebar-section-title">Stations</span>
                <span class="sidebar-section-count">${totalServices}</span>
            </div>
            <ul class="station-list">
    `;

    // Collect all audio services across transponders, then sort alphabetically
    const allAudioServices = [];
    currentTransponders.forEach((tp) => {
        const audioServices = filterAudioServices(tp.services);
        audioServices.forEach((svc) => {
            allAudioServices.push({ svc, tp });
        });
    });
    allAudioServices.sort((a, b) => {
        const nameA = (a.svc.name || a.svc.label || '').toLowerCase();
        const nameB = (b.svc.name || b.svc.label || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    allAudioServices.forEach(({ svc, tp }) => {
        const isActive = String(svc.sid) === String(activeSid);
        const bitrate = svc.bitrate ? `${svc.bitrate}k` : '';
        const cachedUrl = getCachedLogo(svc.sid);
        const thumbContent = cachedUrl
            ? `<img src="${cachedUrl}" alt="" class="station-item-thumb-img">`
            : `<span class="station-item-thumb-fallback">${FALLBACK_THUMB_ICON}</span>`;

        html += `
            <li class="station-item ${isActive ? 'active' : ''}"
                data-sid="${escapeAttr(String(svc.sid || ''))}"
                data-name="${escapeAttr(svc.name || '')}"
                data-channel="${escapeAttr(tp.channel || '')}">
                <span class="station-item-thumb" data-thumb-sid="${escapeAttr(String(svc.sid || ''))}">${thumbContent}</span>
                <span class="station-item-name">${escapeHtml(svc.name || svc.label || `Service ${svc.sid}`)}</span>
                <span class="station-item-bitrate">${escapeHtml(bitrate)}</span>
            </li>
        `;
    });

    html += `
            </ul>
        </div>
    `;

    containerEl.innerHTML = html;

    // Bind click events for stations
    containerEl.querySelectorAll('.station-item').forEach((el) => {
        el.addEventListener('click', () => {
            const sid = el.dataset.sid;
            const name = el.dataset.name;
            const channel = el.dataset.channel;

            // Find the transponder for this station
            const transponder = currentTransponders.find(t => t.channel === channel);

            activeSid = sid;
            if (selectCallback) {
                selectCallback(sid, name, transponder);
            }
            render();
        });
    });

    // Bind click events for transponders (filter or highlight)
    containerEl.querySelectorAll('.transponder-item').forEach((el) => {
        el.addEventListener('click', () => {
            const channel = el.dataset.channel;
            activeChannelName = channel;
            render();
        });
    });

    // Background-fetch logos for stations without cached thumbnails (throttled)
    const uncachedThumbs = Array.from(
        containerEl.querySelectorAll('.station-item-thumb[data-thumb-sid]')
    ).filter(el => !getCachedLogo(el.dataset.thumbSid));

    const BATCH_SIZE = 3;
    let batchIndex = 0;
    function fetchNextBatch() {
        const batch = uncachedThumbs.slice(batchIndex, batchIndex + BATCH_SIZE);
        if (batch.length === 0) return;
        batchIndex += BATCH_SIZE;
        Promise.all(batch.map(el => {
            const sid = el.dataset.thumbSid;
            return fetchAndCacheLogo(sid).then(blobUrl => {
                if (blobUrl && el.isConnected) {
                    el.innerHTML = `<img src="${blobUrl}" alt="" class="station-item-thumb-img">`;
                }
            }).catch(() => { /* logo fetch failed, will retry later */ });
        })).then(() => {
            setTimeout(fetchNextBatch, 200);
        });
    }
    fetchNextBatch();
}

