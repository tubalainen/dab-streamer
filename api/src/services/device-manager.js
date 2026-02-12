'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('../config');

/**
 * Make a simple HTTP GET request and return parsed JSON.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse response from ${url}: ${body}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out after 10s`));
    });
  });
}

/**
 * Probe dab-server for connected RTL-SDR devices, save to devices.json, and return the list.
 */
async function probeDevices() {
  const url = `${config.DAB_SERVER_URL}/devices`;
  console.log('[device-manager] Probing devices at', url);

  const result = await httpGet(url);
  const devices = Array.isArray(result) ? result : (result.devices || []);

  ensureDataDir();
  fs.writeFileSync(config.DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
  console.log(`[device-manager] Found ${devices.length} device(s)`);
  return devices;
}

/**
 * Read the cached devices list from devices.json.
 */
function getDevices() {
  try {
    if (!fs.existsSync(config.DEVICES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(config.DEVICES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[device-manager] Error reading devices.json:', err.message);
    return [];
  }
}

/**
 * Get detailed status for a single device including lock information.
 */
function getDeviceStatus(index) {
  const devices = getDevices();
  const device = devices.find((d) => d.index === index) || devices[index] || null;

  if (!device) {
    return null;
  }

  return {
    ...device,
    index: device.index !== undefined ? device.index : index,
    locked: isLocked(index),
    lock: isLocked(index) ? getLock(index) : null,
  };
}

/**
 * Acquire a lock on a device. Throws if the device is already locked.
 *
 * @param {number} index - Device index
 * @param {string} purpose - Lock purpose (e.g. "scanning", "streaming")
 * @param {object} details - Additional lock metadata
 */
function acquireLock(index, purpose, details = {}) {
  ensureLocksDir();

  const lockFile = getLockFilePath(index);

  if (fs.existsSync(lockFile)) {
    const existing = getLock(index);
    throw new Error(
      `Device ${index} is already locked for "${existing.purpose}" since ${existing.acquired_at}`
    );
  }

  const lockData = {
    device_index: index,
    purpose,
    details,
    pid: process.pid,
    acquired_at: new Date().toISOString(),
  };

  // Write atomically using writeFileSync with exclusive flag
  try {
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`Device ${index} is already locked (race condition)`);
    }
    throw err;
  }

  console.log(`[device-manager] Lock acquired on device ${index} for "${purpose}"`);
  return lockData;
}

/**
 * Release a lock on a device.
 */
function releaseLock(index) {
  const lockFile = getLockFilePath(index);
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log(`[device-manager] Lock released on device ${index}`);
      return true;
    }
  } catch (err) {
    console.error(`[device-manager] Error releasing lock on device ${index}:`, err.message);
  }
  return false;
}

/**
 * Check if a device is currently locked.
 */
function isLocked(index) {
  return fs.existsSync(getLockFilePath(index));
}

/**
 * Read lock file contents for a device.
 */
function getLock(index) {
  const lockFile = getLockFilePath(index);
  try {
    if (!fs.existsSync(lockFile)) {
      return null;
    }
    const raw = fs.readFileSync(lockFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[device-manager] Error reading lock for device ${index}:`, err.message);
    return null;
  }
}

/**
 * Remove stale locks whose owning PIDs are no longer running.
 * On Linux/Alpine, we check /proc/<pid> existence.
 */
function reapStaleLocks() {
  ensureLocksDir();

  let files;
  try {
    files = fs.readdirSync(config.LOCKS_DIR);
  } catch (err) {
    return;
  }

  for (const file of files) {
    if (!file.endsWith('.lock')) continue;

    const lockPath = path.join(config.LOCKS_DIR, file);
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const lock = JSON.parse(raw);

      // Check if the PID is still alive
      if (lock.pid && lock.pid !== process.pid) {
        try {
          // Sending signal 0 tests if the process exists
          process.kill(lock.pid, 0);
        } catch (e) {
          // Process doesn't exist, reap the lock
          console.log(`[device-manager] Reaping stale lock: ${file} (PID ${lock.pid} is dead)`);
          fs.unlinkSync(lockPath);
        }
      }

      // Also reap locks older than 10 minutes regardless
      if (lock.acquired_at) {
        const age = Date.now() - new Date(lock.acquired_at).getTime();
        const maxAge = 10 * 60 * 1000; // 10 minutes
        if (age > maxAge) {
          console.log(`[device-manager] Reaping aged lock: ${file} (${Math.round(age / 1000)}s old)`);
          fs.unlinkSync(lockPath);
        }
      }
    } catch (err) {
      // Corrupt lock file, remove it
      console.error(`[device-manager] Removing corrupt lock file: ${file}`);
      try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
    }
  }
}

/**
 * Delete the cached devices.json so the next GET /api/devices auto-probes.
 */
function clearDevices() {
  try {
    if (fs.existsSync(config.DEVICES_FILE)) {
      fs.unlinkSync(config.DEVICES_FILE);
      console.log('[device-manager] devices.json cleared');
    }
  } catch (err) {
    console.error('[device-manager] Error clearing devices.json:', err.message);
  }
}

/**
 * Update a device's label in devices.json.
 */
function setDeviceLabel(index, label) {
  const devices = getDevices();
  let found = false;

  for (const device of devices) {
    const deviceIdx = device.index !== undefined ? device.index : devices.indexOf(device);
    if (deviceIdx === index) {
      device.label = label;
      found = true;
      break;
    }
  }

  if (!found) {
    // If index-based lookup, try array position
    if (index >= 0 && index < devices.length) {
      devices[index].label = label;
      found = true;
    }
  }

  if (!found) {
    throw new Error(`Device ${index} not found`);
  }

  ensureDataDir();
  fs.writeFileSync(config.DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
  console.log(`[device-manager] Device ${index} label set to "${label}"`);
  return devices;
}

// --- Helpers ---

function getLockFilePath(index) {
  return path.join(config.LOCKS_DIR, `device-${index}.lock`);
}

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
}

function ensureLocksDir() {
  if (!fs.existsSync(config.LOCKS_DIR)) {
    fs.mkdirSync(config.LOCKS_DIR, { recursive: true });
  }
}

module.exports = {
  probeDevices,
  getDevices,
  getDeviceStatus,
  acquireLock,
  releaseLock,
  isLocked,
  getLock,
  reapStaleLocks,
  setDeviceLabel,
  clearDevices,
};
