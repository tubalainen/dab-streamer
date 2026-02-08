'use strict';

const path = require('path');

const config = {
  API_PORT: parseInt(process.env.API_PORT, 10) || 3000,
  WELLE_PORT: parseInt(process.env.WELLE_PORT, 10) || 7979,
  DAB_SERVER_HOST: process.env.DAB_SERVER_HOST || 'dab-server',
  DAB_SERVER_MGMT_PORT: parseInt(process.env.DAB_SERVER_MGMT_PORT, 10) || 8888,
  SCAN_TIMEOUT: parseInt(process.env.SCAN_TIMEOUT, 10) || 10,
  DEFAULT_CHANNEL: process.env.DEFAULT_CHANNEL || '5A',
  LOCK_REAPER_INTERVAL: parseInt(process.env.LOCK_REAPER_INTERVAL, 10) || 30,
  KEEP_SCAN_DATA_ON_RESET: (process.env.KEEP_SCAN_DATA_ON_RESET || 'true').toLowerCase() === 'true',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  DATA_DIR: process.env.DATA_DIR || '/data',
};

// Derived paths
config.SETUP_FILE = path.join(config.DATA_DIR, 'setup.json');
config.DEVICES_FILE = path.join(config.DATA_DIR, 'devices.json');
config.CHANNELS_FILE = path.join(config.DATA_DIR, 'channels.json');
config.LOCKS_DIR = path.join(config.DATA_DIR, 'locks');
config.LOGOS_DIR = path.join(config.DATA_DIR, 'logos');

// dab-server management API base URL
config.DAB_SERVER_URL = `http://${config.DAB_SERVER_HOST}:${config.DAB_SERVER_MGMT_PORT}`;

// welle-cli base URL (proxied through dab-server management API)
config.WELLE_URL = `http://${config.DAB_SERVER_HOST}:${config.WELLE_PORT}`;

module.exports = config;
