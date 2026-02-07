'use strict';

const { Router } = require('express');
const setupStore = require('../services/setup-store');
const deviceManager = require('../services/device-manager');
const dabBackend = require('../services/dab-backend');

const router = Router();

/**
 * GET /api/status
 * Health check endpoint returning overall system status.
 */
router.get('/', async (req, res) => {
  try {
    const setupComplete = setupStore.isSetupComplete();
    const devices = deviceManager.getDevices();

    // Count active streams (devices locked for streaming)
    let activeStreams = 0;
    for (let i = 0; i < devices.length; i++) {
      const idx = devices[i].index !== undefined ? devices[i].index : i;
      if (deviceManager.isLocked(idx)) {
        const lock = deviceManager.getLock(idx);
        if (lock && lock.purpose === 'streaming') {
          activeStreams++;
        }
      }
    }

    // Check dab-server health
    let backendHealthy = false;
    try {
      backendHealthy = await dabBackend.isHealthy();
    } catch (err) {
      // backend unreachable
    }

    res.json({
      healthy: true,
      setup_complete: setupComplete,
      devices_count: devices.length,
      active_streams: activeStreams,
      backend_healthy: backendHealthy,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      healthy: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;
