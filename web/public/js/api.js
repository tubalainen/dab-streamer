/**
 * DAB+ Radio Streamer — API Client Module
 *
 * All functions return promises. Errors are thrown with status code information.
 */

const BASE = '/api';

async function request(method, path, body = null) {
    const opts = {
        method,
        headers: {},
    };

    if (body !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }

    const res = await fetch(`${BASE}${path}`, opts);

    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const err = await res.json();
            if (err.error) message = err.error;
            else if (err.message) message = err.message;
        } catch {
            // response body was not JSON
        }
        const error = new Error(message);
        error.status = res.status;
        throw error;
    }

    // 204 No Content
    if (res.status === 204) return null;

    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return res.json();
    }

    return null;
}

// ─── Setup ──────────────────────────────────────────────

export async function getSetupStatus() {
    return request('GET', '/setup/status');
}

export async function completeSetup(deviceIndex, deviceSerial, transponder) {
    return request('POST', '/setup/complete', {
        device_index: deviceIndex,
        device_serial: deviceSerial,
        transponder: typeof transponder === 'string'
            ? { channel: transponder }
            : transponder,
    });
}

export async function resetSetup() {
    return request('POST', '/setup/reset');
}

// ─── Devices ────────────────────────────────────────────

export async function getDevices() {
    return request('GET', '/devices');
}

export async function probeDevices() {
    return request('POST', '/devices/probe');
}

export async function getDeviceStatus(index) {
    return request('GET', `/devices/${index}/status`);
}

// ─── Scanner ────────────────────────────────────────────

export async function startScan(deviceIndex) {
    return request('POST', `/scan/${deviceIndex}`);
}

export async function getScanProgress(deviceIndex) {
    return request('GET', `/scan/${deviceIndex}/progress`);
}

export async function cancelScan(deviceIndex) {
    return request('POST', `/scan/${deviceIndex}/cancel`);
}

// ─── Channels ───────────────────────────────────────────

export async function getChannels() {
    return request('GET', '/channels');
}

export async function getChannelsForDevice(deviceIndex) {
    return request('GET', `/channels/${deviceIndex}`);
}

// ─── Tuner ──────────────────────────────────────────────

export async function tune(deviceIndex, channel) {
    return request('POST', '/tune', { device_index: deviceIndex, channel });
}

export async function tuneAndDiscover(deviceIndex, channel) {
    return request('POST', '/tune-discover', { device_index: deviceIndex, channel });
}

export async function getCurrentInfo() {
    return request('GET', '/current');
}

export async function getDLS(sid) {
    return request('GET', `/dls/${sid}`);
}

// ─── Settings ──────────────────────────────────────────

export async function getSettings() {
    return request('GET', '/settings');
}

export async function updateSettings(settings) {
    return request('POST', '/settings', settings);
}

// ─── Health ─────────────────────────────────────────────

export async function getStatus() {
    return request('GET', '/status');
}
