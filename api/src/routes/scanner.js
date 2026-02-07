'use strict';

const { Router } = require('express');
const scanner = require('../services/scanner');

const router = Router();

/**
 * POST /api/scan/:deviceIndex
 * Start a channel scan on the specified device.
 */
router.post('/:deviceIndex', async (req, res) => {
  try {
    const deviceIndex = parseInt(req.params.deviceIndex, 10);

    if (isNaN(deviceIndex) || deviceIndex < 0) {
      return res.status(400).json({ error: 'Invalid device index' });
    }

    const result = await scanner.startScan(deviceIndex);
    res.json(result);
  } catch (err) {
    console.error('[scanner-route] Start scan failed:', err.message);

    // If already locked, return 409 Conflict
    if (err.message.includes('already locked')) {
      return res.status(409).json({ error: err.message });
    }

    res.status(500).json({ error: 'Failed to start scan', details: err.message });
  }
});

/**
 * GET /api/scan/:deviceIndex/progress
 * Get the progress of a running scan.
 */
router.get('/:deviceIndex/progress', async (req, res) => {
  try {
    const deviceIndex = parseInt(req.params.deviceIndex, 10);
    const progress = await scanner.getScanProgress(deviceIndex);
    res.json(progress);
  } catch (err) {
    console.error('[scanner-route] Get progress failed:', err.message);
    res.status(502).json({ error: 'Failed to get scan progress', details: err.message });
  }
});

/**
 * POST /api/scan/:deviceIndex/cancel
 * Cancel a running scan on the specified device.
 */
router.post('/:deviceIndex/cancel', async (req, res) => {
  try {
    const deviceIndex = parseInt(req.params.deviceIndex, 10);
    const result = await scanner.cancelScan(deviceIndex);
    res.json(result);
  } catch (err) {
    console.error('[scanner-route] Cancel scan failed:', err.message);
    res.status(500).json({ error: 'Failed to cancel scan', details: err.message });
  }
});

module.exports = router;
