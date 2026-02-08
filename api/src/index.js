'use strict';

const express = require('express');
const config = require('./config');
const setupStore = require('./services/setup-store');
const deviceManager = require('./services/device-manager');
const dabBackend = require('./services/dab-backend');

// Import route modules
const setupRoutes = require('./routes/setup');
const devicesRoutes = require('./routes/devices');
const channelsRoutes = require('./routes/channels');
const tunerRoutes = require('./routes/tuner');
const scannerRoutes = require('./routes/scanner');
const settingsRoutes = require('./routes/settings');
const healthRoutes = require('./routes/health');

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// JSON body parser
app.use(express.json());

// CORS headers (allow all origins for local development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Skip logging for high-frequency polling endpoints
    if (!req.path.startsWith('/api/stream/') && !req.path.startsWith('/api/dls/') && !req.path.startsWith('/api/slide/') && req.path !== '/api/status') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/api/setup', setupRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/tune', tunerRoutes);             // POST /api/tune
app.use('/api', tunerRoutes);                   // GET /api/current, GET /api/stream/:sid
app.use('/api/scan', scannerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/status', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'dab-streamer-api',
    version: '1.0.0',
    endpoints: [
      'GET  /api/status',
      'GET  /api/setup/status',
      'POST /api/setup/complete',
      'POST /api/setup/reset',
      'GET  /api/devices',
      'POST /api/devices/probe',
      'PATCH /api/devices/:index',
      'GET  /api/devices/:index/status',
      'GET  /api/channels',
      'GET  /api/channels/:deviceIndex',
      'POST /api/tune',
      'GET  /api/current',
      'GET  /api/stream/:sid',
      'POST /api/scan/:deviceIndex',
      'GET  /api/scan/:deviceIndex/progress',
      'POST /api/scan/:deviceIndex/cancel',
      'GET  /api/settings',
      'POST /api/settings',
    ],
  });
});

// ---------------------------------------------------------------------------
// Error handling middleware
// ---------------------------------------------------------------------------

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.stack || err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * On startup, if setup is complete, attempt to auto-tune to the saved configuration
 * so that streaming resumes after a container restart.
 */
async function autoTuneOnStartup() {
  try {
    const setup = setupStore.getSetupStatus();
    if (!setup.completed || !setup.selected_device || !setup.selected_transponder) {
      console.log('[startup] Setup not complete, skipping auto-tune');
      return;
    }

    const deviceIndex = setup.selected_device.index;
    const channel = setup.selected_transponder.channel;

    console.log(`[startup] Auto-tuning to device ${deviceIndex}, channel ${channel}...`);

    // Small delay to let dab-server come up first
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await dabBackend.startStreaming(deviceIndex, channel);
    console.log(`[startup] Auto-tune successful: device ${deviceIndex}, channel ${channel}`);
  } catch (err) {
    console.error('[startup] Auto-tune failed (will retry when user interacts):', err.message);
  }
}

/**
 * Start the stale lock reaper on a periodic interval.
 */
function startLockReaper() {
  const intervalMs = config.LOCK_REAPER_INTERVAL * 1000;
  console.log(`[startup] Lock reaper running every ${config.LOCK_REAPER_INTERVAL}s`);

  // Run once immediately
  deviceManager.reapStaleLocks();

  // Then on interval
  setInterval(() => {
    try {
      deviceManager.reapStaleLocks();
    } catch (err) {
      console.error('[lock-reaper] Error:', err.message);
    }
  }, intervalMs);
}

// Ensure persistent directories exist
const fs = require('fs');
[config.LOCKS_DIR, config.LOGOS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[startup] Created directory: ${dir}`);
  }
});

// Start the server
app.listen(config.API_PORT, () => {
  console.log(`[dab-streamer-api] Listening on port ${config.API_PORT}`);
  console.log(`[dab-streamer-api] DAB server: ${config.DAB_SERVER_URL}`);
  console.log(`[dab-streamer-api] Data directory: ${config.DATA_DIR}`);

  // Start periodic lock reaping
  startLockReaper();

  // Auto-tune if setup is already complete
  autoTuneOnStartup();
});

module.exports = app;
