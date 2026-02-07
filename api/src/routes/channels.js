'use strict';

const { Router } = require('express');
const channelStore = require('../services/channel-store');

const router = Router();

/**
 * GET /api/channels
 * Return all scan results across all devices.
 */
router.get('/', (req, res) => {
  try {
    const scans = channelStore.getAllScanResults();
    res.json(scans);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read channel data', details: err.message });
  }
});

/**
 * GET /api/channels/:deviceIndex
 * Return scan results (transponders) for a specific device.
 */
router.get('/:deviceIndex', (req, res) => {
  try {
    const deviceIndex = parseInt(req.params.deviceIndex, 10);
    const transponders = channelStore.getScanResults(deviceIndex);
    res.json({
      device_index: deviceIndex,
      transponders,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read channel data', details: err.message });
  }
});

module.exports = router;
