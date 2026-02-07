'use strict';

const http = require('http');
const config = require('../config');
const deviceManager = require('./device-manager');
const channelStore = require('./channel-store');

/**
 * Make an HTTP request and return parsed JSON.
 */
function httpRequest(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'Accept': 'application/json' },
      timeout: 30000,
    };

    let payload = null;
    if (body !== null) {
      payload = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out: ${url}`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// In-flight scan tracking
const activeScans = new Map();

/**
 * Start a scan on a specific device.
 * Acquires a lock, sends the scan command to dab-server, and kicks off background polling.
 *
 * @param {number} deviceIndex - RTL-SDR device index
 * @returns {object} { scan_id, device_index, status }
 */
async function startScan(deviceIndex) {
  const idx = parseInt(deviceIndex, 10);

  // Acquire device lock for scanning
  deviceManager.acquireLock(idx, 'scanning', { started_at: new Date().toISOString() });

  try {
    // Tell dab-server to start scanning
    const url = `${config.DAB_SERVER_URL}/scan`;
    const result = await httpRequest('POST', url, { device_index: idx });

    const scanId = `scan-${idx}-${Date.now()}`;

    // Track this scan
    activeScans.set(idx, {
      scan_id: scanId,
      device_index: idx,
      status: 'running',
      started_at: new Date().toISOString(),
    });

    // Start background polling to auto-save results when complete
    waitForScanComplete(idx).catch((err) => {
      console.error(`[scanner] Background scan wait failed for device ${idx}:`, err.message);
    });

    console.log(`[scanner] Scan started on device ${idx}: ${scanId}`);
    return { scan_id: scanId, device_index: idx, status: 'running', ...result };
  } catch (err) {
    // Release lock on failure
    deviceManager.releaseLock(idx);
    throw err;
  }
}

/**
 * Get current scan progress from dab-server.
 *
 * @param {number} deviceIndex - Device index
 * @returns {Promise<object>} Progress data from dab-server
 */
async function getScanProgress(deviceIndex) {
  const url = `${config.DAB_SERVER_URL}/scan/progress`;
  const progress = await httpRequest('GET', url);

  const idx = parseInt(deviceIndex, 10);
  const tracked = activeScans.get(idx);

  return {
    device_index: idx,
    scan_id: tracked ? tracked.scan_id : null,
    ...progress,
  };
}

/**
 * Cancel a running scan on a device.
 *
 * @param {number} deviceIndex - Device index
 */
async function cancelScan(deviceIndex) {
  const idx = parseInt(deviceIndex, 10);

  try {
    const url = `${config.DAB_SERVER_URL}/scan/cancel`;
    await httpRequest('POST', url);
    console.log(`[scanner] Scan cancelled on device ${idx}`);
  } finally {
    activeScans.delete(idx);
    deviceManager.releaseLock(idx);
  }

  return { device_index: idx, status: 'cancelled' };
}

/**
 * Poll dab-server scan progress until the scan is complete.
 * When complete, saves results to channels.json and releases the device lock.
 *
 * @param {number} deviceIndex - Device index
 */
async function waitForScanComplete(deviceIndex) {
  const idx = parseInt(deviceIndex, 10);
  const pollInterval = 2000; // 2 seconds
  const timeout = config.SCAN_TIMEOUT * 60 * 1000; // Convert minutes to ms
  const startTime = Date.now();

  console.log(`[scanner] Waiting for scan to complete on device ${idx}...`);

  while (true) {
    // Check timeout
    if (Date.now() - startTime > timeout) {
      console.error(`[scanner] Scan timed out on device ${idx} after ${config.SCAN_TIMEOUT} minutes`);
      activeScans.delete(idx);
      deviceManager.releaseLock(idx);
      throw new Error(`Scan timed out after ${config.SCAN_TIMEOUT} minutes`);
    }

    // Check if scan was cancelled externally
    if (!activeScans.has(idx)) {
      console.log(`[scanner] Scan on device ${idx} was cancelled or removed`);
      return;
    }

    try {
      const progress = await getScanProgress(idx);

      // Check if scan is complete
      if (progress.finished || progress.status === 'complete' || progress.status === 'finished') {
        console.log(`[scanner] Scan complete on device ${idx}`);

        // Extract transponders from the scan results
        const transponders = progress.transponders || progress.results || [];

        // Get device serial for storage
        const devices = deviceManager.getDevices();
        const device = devices.find((d) => (d.index !== undefined ? d.index : devices.indexOf(d)) === idx);
        const serial = device ? (device.serial || device.name || '') : '';

        // Save results
        channelStore.saveScanResults(idx, serial, transponders);

        // Update tracking
        const tracked = activeScans.get(idx);
        if (tracked) {
          tracked.status = 'complete';
        }
        activeScans.delete(idx);

        // Release lock
        deviceManager.releaseLock(idx);

        return { device_index: idx, transponders };
      }
    } catch (err) {
      console.error(`[scanner] Error polling scan progress for device ${idx}:`, err.message);
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Check if a scan is currently active on a device.
 */
function isScanning(deviceIndex) {
  return activeScans.has(parseInt(deviceIndex, 10));
}

module.exports = {
  startScan,
  getScanProgress,
  cancelScan,
  waitForScanComplete,
  isScanning,
};
