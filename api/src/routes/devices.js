'use strict';

const { Router } = require('express');
const deviceManager = require('../services/device-manager');

const router = Router();

/**
 * GET /api/devices
 * List all known devices with their lock status.
 * Auto-probes dab-server on first call if no cached data exists.
 */
router.get('/', async (req, res) => {
  try {
    let devices = deviceManager.getDevices();

    // Auto-probe if no cached devices exist (first startup)
    if (!devices || devices.length === 0) {
      console.log('[devices] No cached devices, auto-probing...');
      try {
        devices = await deviceManager.probeDevices();
      } catch (probeErr) {
        console.error('[devices] Auto-probe failed:', probeErr.message);
        devices = [];
      }
    }

    // Enrich each device with lock status
    const enriched = devices.map((device, i) => {
      const idx = device.index !== undefined ? device.index : i;
      return {
        ...device,
        index: idx,
        locked: deviceManager.isLocked(idx),
        lock: deviceManager.isLocked(idx) ? deviceManager.getLock(idx) : null,
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list devices', details: err.message });
  }
});

/**
 * POST /api/devices/probe
 * Re-detect RTL-SDR devices from dab-server.
 */
router.post('/probe', async (req, res) => {
  try {
    const devices = await deviceManager.probeDevices();
    res.json({ success: true, devices });
  } catch (err) {
    console.error('[devices] Probe failed:', err.message);
    res.status(502).json({ error: 'Failed to probe devices from dab-server', details: err.message });
  }
});

/**
 * PATCH /api/devices/:index
 * Update a device's label.
 *
 * Body: { label: string }
 */
router.patch('/:index', (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const { label } = req.body;

    if (label === undefined || label === null) {
      return res.status(400).json({ error: 'label is required' });
    }

    deviceManager.setDeviceLabel(index, label);
    res.json({ success: true, device_index: index, label });
  } catch (err) {
    console.error('[devices] Update failed:', err.message);
    res.status(err.message.includes('not found') ? 404 : 500).json({
      error: 'Failed to update device',
      details: err.message,
    });
  }
});

/**
 * GET /api/devices/:index/status
 * Get detailed status for a single device.
 */
router.get('/:index/status', (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const status = deviceManager.getDeviceStatus(index);

    if (!status) {
      return res.status(404).json({ error: `Device ${index} not found` });
    }

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get device status', details: err.message });
  }
});

module.exports = router;
