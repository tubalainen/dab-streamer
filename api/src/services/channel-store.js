'use strict';

const fs = require('fs');
const config = require('../config');

/**
 * Read the full channels.json data structure.
 * Returns { scans: [ { device_index, device_serial, transponders, scanned_at } ] }
 */
function readChannelsFile() {
  try {
    if (!fs.existsSync(config.CHANNELS_FILE)) {
      return { scans: [] };
    }
    const raw = fs.readFileSync(config.CHANNELS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data && data.scans ? data : { scans: [] };
  } catch (err) {
    console.error('[channel-store] Error reading channels.json:', err.message);
    return { scans: [] };
  }
}

/**
 * Write the channels data to disk.
 */
function writeChannelsFile(data) {
  ensureDataDir();
  fs.writeFileSync(config.CHANNELS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Get scan results (transponders) for a specific device.
 *
 * @param {number} deviceIndex - Device index to look up
 * @returns {Array} Array of transponder objects, or empty array
 */
function getScanResults(deviceIndex) {
  const data = readChannelsFile();
  const idx = parseInt(deviceIndex, 10);
  const entry = data.scans.find((s) => s.device_index === idx);
  return entry ? entry.transponders : [];
}

/**
 * Get the full scans array with all devices' scan results.
 */
function getAllScanResults() {
  const data = readChannelsFile();
  return data.scans;
}

/**
 * Save (upsert) scan results for a specific device.
 * If the device already has results, they are replaced.
 *
 * @param {number} deviceIndex - Device index
 * @param {string} deviceSerial - Device serial string
 * @param {Array} transponders - Array of transponder objects from the scan
 */
function saveScanResults(deviceIndex, deviceSerial, transponders) {
  const data = readChannelsFile();
  const idx = parseInt(deviceIndex, 10);

  const entry = {
    device_index: idx,
    device_serial: deviceSerial || null,
    transponders: transponders || [],
    scanned_at: new Date().toISOString(),
  };

  const existingIdx = data.scans.findIndex((s) => s.device_index === idx);
  if (existingIdx >= 0) {
    data.scans[existingIdx] = entry;
  } else {
    data.scans.push(entry);
  }

  writeChannelsFile(data);
  console.log(
    `[channel-store] Saved ${transponders.length} transponder(s) for device ${idx}`
  );
  return entry;
}

/**
 * Delete all scan data.
 */
function clearScanResults() {
  writeChannelsFile({ scans: [] });
  console.log('[channel-store] All scan results cleared');
}

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
}

module.exports = {
  getScanResults,
  getAllScanResults,
  saveScanResults,
  clearScanResults,
};
