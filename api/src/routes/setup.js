'use strict';

const { Router } = require('express');
const setupStore = require('../services/setup-store');
const dabBackend = require('../services/dab-backend');
const deviceManager = require('../services/device-manager');
const channelStore = require('../services/channel-store');
const config = require('../config');

const router = Router();

/**
 * GET /api/setup/status
 * Return the current setup wizard state.
 */
router.get('/status', (req, res) => {
  try {
    const status = setupStore.getSetupStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read setup status', details: err.message });
  }
});

/**
 * POST /api/setup/complete
 * Finalize setup wizard: save selections and start streaming.
 *
 * Body: {
 *   device_index: number,
 *   device_serial: string,
 *   transponder: { channel: string, ensemble_label: string, ensemble_id: string }
 * }
 */
router.post('/complete', async (req, res) => {
  try {
    const { device_index, device_serial, transponder } = req.body;

    if (device_index === undefined || device_index === null) {
      return res.status(400).json({ error: 'device_index is required' });
    }
    if (!transponder || !transponder.channel) {
      return res.status(400).json({ error: 'transponder with channel is required' });
    }

    const idx = parseInt(device_index, 10);

    // Save the setup configuration
    setupStore.saveSetup(idx, device_serial || '', transponder);

    // Start streaming on the selected device and channel
    try {
      await dabBackend.startStreaming(idx, transponder.channel);
      console.log(`[setup] Streaming started on device ${idx}, channel ${transponder.channel}`);
    } catch (streamErr) {
      console.error('[setup] Warning: Failed to start streaming after setup:', streamErr.message);
      // Setup is still saved even if streaming fails to start immediately
    }

    res.json({
      success: true,
      message: 'Setup complete',
      device_index: idx,
      channel: transponder.channel,
    });
  } catch (err) {
    console.error('[setup] Error completing setup:', err.message);
    res.status(500).json({ error: 'Failed to complete setup', details: err.message });
  }
});

/**
 * POST /api/setup/reset
 * Reset setup: stop streaming, release locks, clear setup.json.
 */
router.post('/reset', async (req, res) => {
  try {
    // Stop any active streaming
    try {
      await dabBackend.stopStreaming();
    } catch (err) {
      console.warn('[setup] Warning: Failed to stop streaming during reset:', err.message);
    }

    // Release all device locks
    const devices = deviceManager.getDevices();
    for (let i = 0; i < devices.length; i++) {
      const idx = devices[i].index !== undefined ? devices[i].index : i;
      deviceManager.releaseLock(idx);
    }

    // Optionally clear scan data
    if (!config.KEEP_SCAN_DATA_ON_RESET) {
      channelStore.clearScanResults();
    }

    // Reset the setup state
    setupStore.resetSetup();

    res.json({ success: true, message: 'Setup has been reset' });
  } catch (err) {
    console.error('[setup] Error resetting setup:', err.message);
    res.status(500).json({ error: 'Failed to reset setup', details: err.message });
  }
});

module.exports = router;
