/**
 * DAB+ Radio Streamer — Setup Wizard Controller
 *
 * Three-step wizard:
 *   Step 1: Device selection
 *   Step 2: Channel scanning
 *   Step 3: Transponder selection
 */

import * as api from './api.js';
import { renderDeviceCards } from './devices.js';
import { renderScanProgress, renderScanComplete } from './scanner.js';

const STEP_LABELS = ['Select Device', 'Scan Channels', 'Choose Transponder'];

let containerEl = null;
let onCompleteCallback = null;

// All DAB Band III channels
const DAB_CHANNELS = [
    '5A','5B','5C','5D','6A','6B','6C','6D',
    '7A','7B','7C','7D','8A','8B','8C','8D',
    '9A','9B','9C','9D','10A','10B','10C','10D','10N',
    '11A','11B','11C','11D','11N',
    '12A','12B','12C','12D','12N',
    '13A','13B','13C','13D','13E','13F',
];

// Wizard state
let currentStep = 1;
let devices = [];
let devicesLoading = true;
let selectedDevice = null;
let scanPollTimer = null;
let scanResult = null;
let transponders = [];
let selectedTransponder = null;

// Manual channel selection state
let manualChannel = null;
let manualDiscovering = false;
let manualResult = null;
let usedManualMode = false;

/**
 * Initialize and render the setup wizard.
 * @param {HTMLElement} container - Mount point
 * @param {Function} onComplete - Called when setup is finished
 */
export function initWizard(container, onComplete) {
    containerEl = container;
    onCompleteCallback = onComplete;
    currentStep = 1;
    selectedDevice = null;
    scanResult = null;
    transponders = [];
    selectedTransponder = null;
    manualChannel = null;
    manualDiscovering = false;
    manualResult = null;
    usedManualMode = false;

    render();
    loadDevices();
}

// ─── Data Loading ───────────────────────────────────────

async function loadDevices() {
    devicesLoading = true;
    render();

    try {
        const result = await api.getDevices();
        devices = result.devices || result || [];

        // Auto-select if only one device
        if (devices.length === 1) {
            selectedDevice = devices[0];
        }

        devicesLoading = false;
        render();
    } catch (err) {
        devices = [];
        devicesLoading = false;
        render();
        showError(`Failed to load devices: ${err.message}`);
    }
}

async function startScanning() {
    if (!selectedDevice) return;

    try {
        await api.startScan(selectedDevice.index);
        pollScanProgress();
    } catch (err) {
        showError(`Failed to start scan: ${err.message}`);
    }
}

function pollScanProgress() {
    if (scanPollTimer) {
        clearInterval(scanPollTimer);
    }

    scanPollTimer = setInterval(async () => {
        try {
            const progress = await api.getScanProgress(selectedDevice.index);
            scanResult = progress;
            renderStepContent();

            if (progress.status === 'complete' || progress.status === 'completed') {
                clearInterval(scanPollTimer);
                scanPollTimer = null;

                // Short delay to show 100%, then advance
                setTimeout(() => {
                    currentStep = 3;
                    loadTransponders();
                }, 1200);
            }
        } catch (err) {
            clearInterval(scanPollTimer);
            scanPollTimer = null;
            showError(`Scan error: ${err.message}`);
        }
    }, 1000);
}

async function cancelScanning() {
    if (scanPollTimer) {
        clearInterval(scanPollTimer);
        scanPollTimer = null;
    }

    try {
        await api.cancelScan(selectedDevice.index);
    } catch {
        // Ignore cancel errors
    }

    scanResult = null;
}

async function startManualDiscovery() {
    if (!selectedDevice || !manualChannel) return;

    usedManualMode = true;
    manualDiscovering = true;
    manualResult = null;
    currentStep = 3;
    render();

    try {
        const result = await api.tuneAndDiscover(selectedDevice.index, manualChannel);
        manualDiscovering = false;

        if (result.success && result.transponder) {
            transponders = [result.transponder];
            selectedTransponder = result.transponder;
            manualResult = { success: true };
        } else {
            transponders = [];
            selectedTransponder = null;
            manualResult = { success: false, error: result.error || 'No services found' };
        }
        render();
    } catch (err) {
        manualDiscovering = false;
        transponders = [];
        selectedTransponder = null;
        manualResult = { success: false, error: err.message };
        render();
    }
}

async function loadTransponders() {
    try {
        const result = await api.getChannelsForDevice(selectedDevice.index);
        transponders = result.transponders || result.channels || result || [];

        // Auto-select if only one transponder
        if (transponders.length === 1) {
            selectedTransponder = transponders[0];
        }

        render();
    } catch (err) {
        transponders = [];
        render();
        showError(`Failed to load channels: ${err.message}`);
    }
}

async function saveAndFinish() {
    if (!selectedDevice || !selectedTransponder) return;

    try {
        const saveBtn = containerEl.querySelector('.btn-save');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner spinner-sm spinner-inline"></span> Saving...';
        }

        await api.completeSetup(
            selectedDevice.index,
            selectedDevice.serial,
            {
                channel: selectedTransponder.channel || selectedTransponder.name,
                ensemble_label: getEnsembleLabel(selectedTransponder),
                ensemble_id: getEnsembleId(selectedTransponder),
            }
        );

        if (onCompleteCallback) {
            onCompleteCallback();
        }
    } catch (err) {
        showError(`Failed to save setup: ${err.message}`);
        const saveBtn = containerEl.querySelector('.btn-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save & Listen';
        }
    }
}

// ─── Navigation ─────────────────────────────────────────

function goToStep(step) {
    if (step < 1 || step > 3) return;

    // Cancel scan if going back from step 2
    if (currentStep === 2 && step < 2) {
        cancelScanning();
    }

    // Clear manual mode state when going back to step 1
    if (step === 1) {
        manualDiscovering = false;
        manualResult = null;
        usedManualMode = false;
    }

    currentStep = step;

    // Start scan when entering step 2
    if (currentStep === 2) {
        scanResult = null;
        render();
        startScanning();
        return;
    }

    render();
}

// ─── Rendering ──────────────────────────────────────────

function render() {
    if (!containerEl) return;

    containerEl.innerHTML = `
        <div class="wizard-container">
            <div class="wizard-header">
                <div class="wizard-logo">DAB+ <span>Radio Streamer</span></div>
                <div class="wizard-subtitle">Setup your digital radio receiver</div>
            </div>
            ${renderStepIndicator()}
            <div class="step-content" id="wizard-step-content"></div>
            <div class="wizard-nav" id="wizard-nav"></div>
        </div>
    `;

    renderStepContent();
    renderNavigation();
}

function renderStepIndicator() {
    let html = '<div class="step-indicator">';

    for (let i = 1; i <= 3; i++) {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep || (i === 2 && usedManualMode && currentStep === 3);
        const labelClass = isActive ? 'active' : isCompleted ? 'completed' : '';
        const dotClass = isActive ? 'active' : isCompleted ? 'completed' : '';

        html += `
            <div class="step-label ${labelClass}">
                <div class="step-dot ${dotClass}">${isCompleted ? '&#10003;' : i}</div>
                <span class="step-label-text">${STEP_LABELS[i - 1]}</span>
            </div>
        `;

        if (i < 3) {
            html += `<div class="step-line ${isCompleted ? 'completed' : ''}"></div>`;
        }
    }

    html += '</div>';
    return html;
}

function renderStepContent() {
    const contentEl = containerEl.querySelector('#wizard-step-content');
    if (!contentEl) return;

    switch (currentStep) {
        case 1:
            renderStep1(contentEl);
            break;
        case 2:
            renderStep2(contentEl);
            break;
        case 3:
            renderStep3(contentEl);
            break;
    }
}

function renderStep1(contentEl) {
    contentEl.innerHTML = '';

    const header = document.createElement('div');
    header.innerHTML = `
        <h2 class="step-title">Select RTL-SDR Device</h2>
        <p class="step-description">Choose the RTL-SDR device to use for DAB+ reception. If you have multiple devices connected, select the one with the best antenna.</p>
    `;
    contentEl.appendChild(header);

    if (devicesLoading) {
        contentEl.innerHTML += `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-12) 0; gap: var(--space-4);">
                <div class="spinner spinner-lg"></div>
                <span class="text-muted">Detecting RTL-SDR devices...</span>
            </div>
        `;
        return;
    }

    if (devices.length === 0) {
        contentEl.innerHTML += `
            <div class="wizard-empty">
                <div class="wizard-empty-icon">&#128225;</div>
                <h3>No RTL-SDR Devices Found</h3>
                <p>Make sure your RTL-SDR dongle is connected and the container has USB access. Then try again.</p>
                <button class="btn btn-primary" id="btn-retry-devices">Retry Detection</button>
            </div>
        `;

        const retryBtn = contentEl.querySelector('#btn-retry-devices');
        retryBtn.addEventListener('click', () => {
            retryBtn.disabled = true;
            retryBtn.innerHTML = '<span class="spinner spinner-sm spinner-inline"></span> Scanning...';
            loadDevices();
        });
        return;
    }

    const cards = renderDeviceCards(
        devices,
        selectedDevice ? selectedDevice.index : null,
        (device) => {
            selectedDevice = device;
            renderStep1(contentEl);
            renderNavigation();
        }
    );
    contentEl.appendChild(cards);

    // Manual channel selection section
    const manualSection = document.createElement('div');
    manualSection.className = 'manual-channel-section';
    manualSection.innerHTML = `
        <div class="manual-channel-divider">
            <span>or select a known channel</span>
        </div>
        <div class="manual-channel-row">
            <select class="form-control" id="manual-channel-select" ${!selectedDevice ? 'disabled' : ''}>
                <option value="">-- Select channel --</option>
                ${DAB_CHANNELS.map(ch =>
                    `<option value="${ch}" ${manualChannel === ch ? 'selected' : ''}>${ch}</option>`
                ).join('')}
            </select>
            <button class="btn btn-primary" id="btn-use-channel"
                ${!selectedDevice || !manualChannel ? 'disabled' : ''}>
                Use This Channel
            </button>
        </div>
    `;
    contentEl.appendChild(manualSection);

    // Manual channel event handlers
    const selectEl = contentEl.querySelector('#manual-channel-select');
    selectEl.addEventListener('change', (e) => {
        manualChannel = e.target.value || null;
        const useBtn = contentEl.querySelector('#btn-use-channel');
        if (useBtn) {
            useBtn.disabled = !selectedDevice || !manualChannel;
        }
    });

    const useBtn = contentEl.querySelector('#btn-use-channel');
    useBtn.addEventListener('click', () => {
        if (selectedDevice && manualChannel) {
            startManualDiscovery();
        }
    });
}

function renderStep2(contentEl) {
    if (!scanResult) {
        contentEl.innerHTML = `
            <h2 class="step-title">Scanning DAB+ Channels</h2>
            <p class="step-description">Scanning all DAB+ channels to find available transponders and services in your area.</p>
            <div style="display: flex; align-items: center; justify-content: center; padding: var(--space-12) 0; gap: var(--space-4);">
                <div class="spinner spinner-lg"></div>
                <span class="text-muted">Starting scan...</span>
            </div>
        `;
        return;
    }

    const isComplete = scanResult.status === 'complete' || scanResult.status === 'completed';

    contentEl.innerHTML = `
        <h2 class="step-title">${isComplete ? 'Scan Complete' : 'Scanning DAB+ Channels'}</h2>
        <p class="step-description">${isComplete
            ? 'All channels have been scanned. Proceeding to transponder selection...'
            : 'Scanning all DAB+ channels to find available transponders and services in your area.'
        }</p>
        <div id="scan-progress-area"></div>
    `;

    const progressArea = contentEl.querySelector('#scan-progress-area');
    if (isComplete) {
        const tpCount = (scanResult.transponders || []).length;
        const svcCount = (scanResult.transponders || []).reduce(
            (sum, t) => sum + (t.services ? t.services.length : 0), 0
        );
        renderScanComplete(progressArea, tpCount, svcCount);
    } else {
        renderScanProgress(progressArea, scanResult);
    }
}

function renderStep3(contentEl) {
    contentEl.innerHTML = '';

    // Manual discovery: show spinner while discovering
    if (manualDiscovering) {
        contentEl.innerHTML = `
            <h2 class="step-title">Discovering Services</h2>
            <p class="step-description">Tuning to channel ${escapeHtml(manualChannel)} and waiting for service discovery...</p>
            <div style="display: flex; flex-direction: column; align-items: center; padding: var(--space-12) 0; gap: var(--space-4);">
                <div class="spinner spinner-lg"></div>
                <span class="text-muted">Listening for services on channel ${escapeHtml(manualChannel)}...</span>
            </div>
        `;
        return;
    }

    // Manual discovery: show error if nothing found
    if (manualResult && !manualResult.success) {
        contentEl.innerHTML = `
            <h2 class="step-title">No Services Found</h2>
            <p class="step-description">${escapeHtml(manualResult.error || 'No services were found on the selected channel.')}</p>
            <div class="wizard-empty">
                <div class="wizard-empty-icon">&#128246;</div>
                <h3>Channel ${escapeHtml(manualChannel)} has no services</h3>
                <p>Try a different channel or run a full scan to find available transponders.</p>
            </div>
        `;
        return;
    }

    const header = document.createElement('div');
    header.innerHTML = `
        <h2 class="step-title">Choose Transponder</h2>
        <p class="step-description">Select the DAB+ transponder (multiplex) you want to listen to. Each transponder carries multiple radio stations.</p>
    `;
    contentEl.appendChild(header);

    if (transponders.length === 0) {
        contentEl.innerHTML += `
            <div class="wizard-empty">
                <div class="wizard-empty-icon">&#128246;</div>
                <h3>No Signals Found</h3>
                <p>No DAB+ transponders were detected. Try adjusting your antenna position or check signal coverage in your area.</p>
                <button class="btn btn-primary" id="btn-rescan">Rescan Channels</button>
            </div>
        `;

        const rescanBtn = contentEl.querySelector('#btn-rescan');
        rescanBtn.addEventListener('click', () => {
            goToStep(2);
        });
        return;
    }

    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'transponder-cards';

    transponders.forEach((tp) => {
        const isSelected = selectedTransponder &&
            (selectedTransponder.channel === tp.channel || selectedTransponder === tp);
        const services = filterAudioServices(tp.services);

        const card = document.createElement('div');
        card.className = `transponder-card ${isSelected ? 'selected' : ''}`;

        card.innerHTML = `
            <div class="transponder-card-header">
                <div class="transponder-card-radio"></div>
                <div class="transponder-card-info">
                    <div class="transponder-card-name">${escapeHtml(getEnsembleLabel(tp))}</div>
                    <div class="transponder-card-channel">${escapeHtml(tp.channel || '')}</div>
                </div>
                <div class="transponder-card-count">${services.length} services</div>
                <div class="transponder-card-expand">&#9660;</div>
            </div>
            <div class="transponder-card-services">
                <div class="transponder-service-list">
                    ${services.map(svc => `
                        <div class="transponder-service">
                            <span class="transponder-service-name">${escapeHtml(svc.name || svc.label || `Service ${svc.sid}`)}</span>
                            <span class="transponder-service-meta">
                                ${svc.bitrate ? `<span>${svc.bitrate}k</span>` : ''}
                                ${svc.codec ? `<span>${escapeHtml(svc.codec)}</span>` : ''}
                            </span>
                        </div>
                    `).join('')}
                    ${services.length === 0 ? '<div class="text-muted text-center" style="padding: var(--space-3);">No services</div>' : ''}
                </div>
            </div>
        `;

        // Header click: select + toggle expand
        const headerEl = card.querySelector('.transponder-card-header');
        headerEl.addEventListener('click', () => {
            selectedTransponder = tp;

            // Toggle expand
            const wasExpanded = card.classList.contains('expanded');
            // Collapse all
            cardsContainer.querySelectorAll('.transponder-card').forEach(c => {
                c.classList.remove('expanded');
                c.classList.remove('selected');
            });
            // Select this one
            card.classList.add('selected');
            if (!wasExpanded) {
                card.classList.add('expanded');
            }

            renderNavigation();
        });

        // Auto-expand if selected
        if (isSelected) {
            card.classList.add('expanded');
        }

        cardsContainer.appendChild(card);
    });

    contentEl.appendChild(cardsContainer);
}

function renderNavigation() {
    const navEl = containerEl.querySelector('#wizard-nav');
    if (!navEl) return;

    let leftHtml = '';
    let rightHtml = '';

    switch (currentStep) {
        case 1:
            rightHtml = `
                <button class="btn btn-primary btn-lg" id="btn-next"
                    ${!selectedDevice ? 'disabled' : ''}>
                    Scan Channels &rarr;
                </button>
            `;
            break;

        case 2:
            leftHtml = `
                <button class="btn btn-secondary" id="btn-back">&larr; Back</button>
            `;
            // No next button — auto-advances on completion
            break;

        case 3:
            leftHtml = `
                <button class="btn btn-secondary" id="btn-back">&larr; ${usedManualMode ? 'Back' : 'Back to Scan'}</button>
            `;
            if (!manualDiscovering) {
                rightHtml = `
                    <button class="btn btn-primary btn-lg btn-save" id="btn-save"
                        ${!selectedTransponder ? 'disabled' : ''}>
                        Save &amp; Listen
                    </button>
                `;
            }
            break;
    }

    navEl.innerHTML = `
        <div class="wizard-nav-left">${leftHtml}</div>
        <div class="wizard-nav-right">${rightHtml}</div>
    `;

    // Bind navigation events
    const backBtn = navEl.querySelector('#btn-back');
    const nextBtn = navEl.querySelector('#btn-next');
    const saveBtn = navEl.querySelector('#btn-save');

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (currentStep === 2) {
                cancelScanning().then(() => goToStep(1));
            } else if (currentStep === 3 && usedManualMode) {
                // In manual mode, go back to step 1 (skip step 2)
                goToStep(1);
            } else {
                goToStep(currentStep - 1);
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            goToStep(currentStep + 1);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveAndFinish();
        });
    }
}

function showError(message) {
    const contentEl = containerEl.querySelector('#wizard-step-content');
    if (!contentEl) return;

    // Prepend error message
    const existing = contentEl.querySelector('.error-message');
    if (existing) existing.remove();

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message mb-4';
    errorDiv.textContent = message;
    contentEl.prepend(errorDiv);
}

/**
 * Filter services to only include audio services.
 * welle-cli uses lowercase: "audio", "streamdata", "packetdata", "fidc".
 * If transportmode is missing (old scan data), assume audio.
 */
function filterAudioServices(services) {
    if (!services) return [];
    return services.filter(svc => {
        if (svc.transportmode && svc.transportmode !== 'audio') return false;
        return true;
    });
}

/**
 * Safely extract a label string from a welle-cli label field.
 * welle-cli can return labels as:
 *   - a plain string: "Name"
 *   - a nested object: { label: "Name", shortlabel: "N", ... }
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
 * Handles all forms: ensemble as string, object with label string,
 * or object with nested label object (raw welle-cli format).
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

/**
 * Safely extract the ensemble ID from a transponder object.
 */
function getEnsembleId(tp) {
    if (!tp) return null;
    const e = tp.ensemble;
    if (!e) return tp.ensemble_id || null;
    if (typeof e === 'object' && e.id) return e.id;
    return tp.ensemble_id || null;
}

function escapeHtml(str) {
    if (!str) return '';
    if (typeof str !== 'string') str = String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
