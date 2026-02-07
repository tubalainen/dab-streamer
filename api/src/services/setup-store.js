'use strict';

const fs = require('fs');
const config = require('../config');

const DEFAULTS = {
  completed: false,
  selected_device: null,
  selected_transponder: null,
};

/**
 * Read the setup.json file, returning defaults if it doesn't exist or is invalid.
 */
function getSetupStatus() {
  try {
    if (!fs.existsSync(config.SETUP_FILE)) {
      return { ...DEFAULTS };
    }
    const raw = fs.readFileSync(config.SETUP_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      completed: data.completed || false,
      selected_device: data.selected_device || null,
      selected_transponder: data.selected_transponder || null,
    };
  } catch (err) {
    console.error('[setup-store] Error reading setup.json:', err.message);
    return { ...DEFAULTS };
  }
}

/**
 * Returns true if the setup wizard has been completed.
 */
function isSetupComplete() {
  const status = getSetupStatus();
  return status.completed === true;
}

/**
 * Save setup as completed with the selected device and transponder.
 *
 * @param {number} deviceIndex - RTL-SDR device index
 * @param {string} deviceSerial - RTL-SDR device serial string
 * @param {object} transponder - { channel, ensemble_label, ensemble_id }
 */
function saveSetup(deviceIndex, deviceSerial, transponder) {
  const data = {
    completed: true,
    selected_device: {
      index: deviceIndex,
      serial: deviceSerial,
    },
    selected_transponder: transponder,
    updated_at: new Date().toISOString(),
  };
  ensureDataDir();
  fs.writeFileSync(config.SETUP_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('[setup-store] Setup saved:', JSON.stringify(data));
  return data;
}

/**
 * Reset setup to incomplete state, clearing selections.
 */
function resetSetup() {
  const data = {
    completed: false,
    selected_device: null,
    selected_transponder: null,
    updated_at: new Date().toISOString(),
  };
  ensureDataDir();
  fs.writeFileSync(config.SETUP_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log('[setup-store] Setup reset');
  return data;
}

function ensureDataDir() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
  }
}

module.exports = {
  getSetupStatus,
  isSetupComplete,
  saveSetup,
  resetSetup,
};
