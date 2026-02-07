'use strict';

const http = require('http');
const config = require('../config');

/**
 * Make an HTTP request and return parsed JSON.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Full URL
 * @param {object|string|null} body - Request body (will be JSON-stringified if object)
 * @returns {Promise<object>}
 */
function httpRequest(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Accept': 'application/json',
      },
      timeout: 30000,
    };

    let payload = null;
    if (body !== null) {
      if (typeof body === 'object') {
        payload = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
      } else {
        payload = String(body);
        options.headers['Content-Type'] = 'text/plain';
      }
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode} from ${method} ${url}: ${data}`);
          err.statusCode = res.statusCode;
          err.body = data;
          reject(err);
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          // Some endpoints may return non-JSON; return raw text wrapped
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out`));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Start welle-cli streaming on the dab-server.
 *
 * @param {number} deviceIndex - RTL-SDR device index
 * @param {string} channel - DAB channel (e.g. "5A", "12C")
 * @param {number} [gain] - RTL-SDR gain in dB (-1 = AGC)
 * @returns {Promise<object>}
 */
async function startStreaming(deviceIndex, channel, gain) {
  const url = `${config.DAB_SERVER_URL}/start`;
  const payload = {
    device_index: deviceIndex,
    channel: channel,
    port: config.WELLE_PORT,
  };
  if (gain !== undefined && gain !== null) {
    payload.gain = gain;
  }
  console.log(`[dab-backend] Starting streaming: device=${deviceIndex}, channel=${channel}, gain=${gain !== undefined ? gain : 'default'}`);
  return httpRequest('POST', url, payload);
}

/**
 * Get current dab-server settings (gain, etc.).
 */
async function getSettings() {
  const url = `${config.DAB_SERVER_URL}/settings`;
  return httpRequest('GET', url);
}

/**
 * Update dab-server settings (gain, etc.).
 *
 * @param {object} settings - Settings to update (e.g. { gain: 30 })
 */
async function updateSettings(settings) {
  const url = `${config.DAB_SERVER_URL}/settings`;
  console.log(`[dab-backend] Updating settings:`, settings);
  return httpRequest('POST', url, settings);
}

/**
 * Stop welle-cli streaming on the dab-server.
 */
async function stopStreaming() {
  const url = `${config.DAB_SERVER_URL}/stop`;
  console.log('[dab-backend] Stopping streaming');
  return httpRequest('POST', url);
}

/**
 * Get the current ensemble metadata from welle-cli (proxied through dab-server mgmt).
 */
async function getCurrentEnsemble() {
  const url = `${config.DAB_SERVER_URL}/mux.json`;
  return httpRequest('GET', url);
}

/**
 * Switch the channel on welle-cli (proxied through dab-server mgmt).
 *
 * @param {string} channel - DAB channel name (e.g. "5A")
 */
async function switchChannel(channel) {
  const url = `${config.DAB_SERVER_URL}/channel`;
  console.log(`[dab-backend] Switching channel to ${channel}`);
  return httpRequest('POST', url, channel);
}

/**
 * Get the URL for proxying an audio stream for a given service ID.
 *
 * @param {string} sid - Service ID (hex string)
 * @returns {string} Full URL to the mp3 stream
 */
function getStreamUrl(sid) {
  return `${config.WELLE_URL}/mp3/${sid}`;
}

/**
 * Health check on the dab-server management API.
 */
async function isHealthy() {
  try {
    const url = `${config.DAB_SERVER_URL}/health`;
    await httpRequest('GET', url);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  startStreaming,
  stopStreaming,
  getCurrentEnsemble,
  switchChannel,
  getStreamUrl,
  getSettings,
  updateSettings,
  isHealthy,
};
