'use strict';

const { Router } = require('express');
const dabBackend = require('../services/dab-backend');

const router = Router();

/**
 * GET /api/settings
 * Get current dab-server settings (gain, etc.).
 */
router.get('/', async (req, res) => {
  try {
    const settings = await dabBackend.getSettings();
    res.json(settings);
  } catch (err) {
    console.error('[settings] Failed to get settings:', err.message);
    res.status(502).json({ error: 'Failed to get settings', details: err.message });
  }
});

/**
 * POST /api/settings
 * Update dab-server settings.
 *
 * Body: { gain?: number }
 *   gain: -1 for AGC, 0-49 for manual gain in dB
 */
router.post('/', async (req, res) => {
  try {
    const { gain } = req.body;
    const update = {};

    if (gain !== undefined && gain !== null) {
      const g = parseInt(gain, 10);
      if (isNaN(g) || g < -1 || g > 49) {
        return res.status(400).json({ error: 'gain must be between -1 (AGC) and 49 dB' });
      }
      update.gain = g;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No valid settings provided' });
    }

    const result = await dabBackend.updateSettings(update);
    res.json(result);
  } catch (err) {
    console.error('[settings] Failed to update settings:', err.message);
    res.status(500).json({ error: 'Failed to update settings', details: err.message });
  }
});

module.exports = router;
