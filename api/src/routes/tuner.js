'use strict';

const { Router } = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const dabBackend = require('../services/dab-backend');
const channelStore = require('../services/channel-store');
const config = require('../config');

const router = Router();

/**
 * POST /api/tune
 * Tune welle-cli to a specific channel.
 *
 * Body: { device_index: number, channel: string, gain?: number }
 */
router.post('/', async (req, res) => {
  try {
    const { device_index, channel, gain } = req.body;

    if (device_index === undefined || device_index === null) {
      return res.status(400).json({ error: 'device_index is required' });
    }
    if (!channel) {
      return res.status(400).json({ error: 'channel is required' });
    }

    const idx = parseInt(device_index, 10);

    // Start streaming on the requested device and channel (with optional gain)
    const result = await dabBackend.startStreaming(idx, channel, gain);

    console.log(`[tuner] Tuned device ${idx} to channel ${channel}, gain=${gain !== undefined ? gain : 'default'}`);
    res.json({
      success: true,
      device_index: idx,
      channel,
      ...result,
    });
  } catch (err) {
    console.error('[tuner] Tune failed:', err.message);
    res.status(500).json({ error: 'Failed to tune', details: err.message });
  }
});

/**
 * GET /api/current
 * Get the current ensemble info from welle-cli.
 */
router.get('/current', async (req, res) => {
  try {
    const ensemble = await dabBackend.getCurrentEnsemble();
    res.json(ensemble);
  } catch (err) {
    console.error('[tuner] Failed to get current ensemble:', err.message);
    res.status(502).json({ error: 'Failed to get ensemble info', details: err.message });
  }
});

/**
 * GET /api/stream/:sid
 * Proxy the MP3 audio stream from welle-cli (through dab-server).
 * Pipes the response directly to the client with appropriate streaming headers.
 */
router.get('/stream/:sid', (req, res) => {
  const sid = req.params.sid;
  const streamUrl = dabBackend.getStreamUrl(sid);

  console.log(`[tuner] Proxying stream for SID ${sid} from ${streamUrl}`);

  const parsed = new URL(streamUrl);
  const proxyOptions = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: {
      'Accept': '*/*',
    },
    timeout: 10000,
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // Set streaming headers
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'close',
      'X-Content-Type-Options': 'nosniff',
      'Transfer-Encoding': 'chunked',
    });

    // Disable buffering on the response if possible
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Pipe the upstream audio data to the client
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.error(`[tuner] Stream proxy error for SID ${sid}:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream error' });
      } else {
        res.end();
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[tuner] Failed to connect to stream for SID ${sid}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to connect to audio stream', details: err.message });
    }
  });

  proxyReq.on('timeout', () => {
    console.error(`[tuner] Stream connection timed out for SID ${sid}`);
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Stream connection timed out' });
    }
  });

  // If the client disconnects, abort the upstream request
  req.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
});

/**
 * POST /api/tune-discover
 * Tune to a specific channel and wait for service discovery.
 * Used by the wizard for manual channel selection (skip scanning).
 *
 * Body: { device_index: number, channel: string }
 * Returns: { success: boolean, channel: string, transponder: object|null, error?: string }
 */
router.post('/tune-discover', async (req, res) => {
  try {
    const { device_index, channel } = req.body;

    if (device_index === undefined || !channel) {
      return res.status(400).json({ error: 'device_index and channel are required' });
    }

    const idx = parseInt(device_index, 10);

    console.log(`[tuner] Tune-discover: device ${idx}, channel ${channel}`);

    // Start streaming on the channel
    await dabBackend.startStreaming(idx, channel);

    // Poll mux.json for services (wait up to 15 seconds).
    // welle-cli discovers services progressively — service entries appear first,
    // then labels resolve via FIC over the following seconds. We wait until
    // services appear, then keep polling until labels stabilise or we run out of time.
    const maxWait = 15;
    const settleTime = 4; // extra seconds after first services appear for labels to resolve
    let muxData = null;
    let firstSeenAt = -1;
    for (let i = 0; i < maxWait; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const mux = await dabBackend.getCurrentEnsemble();
        if (mux && mux.services && mux.services.length > 0) {
          muxData = mux;
          if (firstSeenAt === -1) firstSeenAt = i;
          // Check if labels have had enough time to resolve
          const elapsed = i - firstSeenAt;
          if (elapsed >= settleTime) break;
          // Also break early if ALL audio services already have labels
          const audioSvcs = mux.services.filter(
            s => s.components && s.components[0] && s.components[0].transportmode === 'audio'
          );
          const labelled = audioSvcs.filter(s => {
            const name = extractLabel(s.label);
            return name && !name.startsWith('Service ');
          });
          if (audioSvcs.length > 0 && labelled.length === audioSvcs.length) break;
        }
      } catch (e) {
        // welle-cli may not be ready yet
      }
    }

    if (!muxData || !muxData.services || muxData.services.length === 0) {
      // Stop streaming since nothing was found
      try { await dabBackend.stopStreaming(); } catch (e) { /* ignore */ }
      return res.json({
        success: false,
        channel,
        error: 'No services found on this channel',
        transponder: null,
      });
    }

    // Build transponder object matching scan.sh format
    const transponder = {
      channel: channel,
      ensemble: {
        label: extractLabel(muxData.ensemble && muxData.ensemble.label) || 'Unknown',
        id: (muxData.ensemble && muxData.ensemble.id) || '0x0000',
      },
      services: (muxData.services || [])
        .filter(svc => svc.components && svc.components[0] && svc.components[0].transportmode === 'audio')
        .map(svc => ({
          sid: svc.sid,
          name: extractLabel(svc.label) || `Service ${svc.sid}`,
          bitrate: svc.components && svc.components[0] && svc.components[0].subchannel
            ? svc.components[0].subchannel.bitrate || 0 : 0,
          codec: svc.components && svc.components[0]
            ? svc.components[0].ascty || 'DAB' : 'DAB',
          language: svc.languagestring || '',
          programme_type: svc.ptystring || '',
          transportmode: 'audio',
        })),
    };

    // Save the discovered transponder to channel store so radio mode can use it
    channelStore.saveScanResults(idx, '', [transponder]);

    console.log(`[tuner] Tune-discover success: ${transponder.services.length} audio services on ${channel}`);

    res.json({
      success: true,
      channel,
      transponder,
    });
  } catch (err) {
    console.error('[tuner] Tune-discover failed:', err.message);
    res.status(500).json({ error: 'Failed to tune and discover', details: err.message });
  }
});

/**
 * Safely extract a label string from a welle-cli label field.
 * Handles nested label objects: { label: { label: "Name", shortlabel: "N" } }
 */
function extractLabel(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && typeof val.label === 'string') return val.label;
  if (typeof val === 'object' && val.label) return extractLabel(val.label);
  return null;
}

/**
 * GET /api/slide/:sid
 * Serve station logo with persistent disk cache.
 *
 * Strategy:
 *   1. Try to fetch live from welle-cli (only works for the actively decoded station)
 *   2. If live succeeds, save/update the disk cache and serve it
 *   3. If live fails (404 — station not being decoded), serve from disk cache
 *   4. If neither is available, return 404
 */
router.get('/slide/:sid', (req, res) => {
  const sid = req.params.sid;
  const cacheFile = path.join(config.LOGOS_DIR, `${sid}.img`);
  const slideUrl = `${config.DAB_SERVER_URL}/slide/${sid}`;

  const parsed = new URL(slideUrl);
  const proxyReq = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    method: 'GET',
    timeout: 5000,
  }, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      // Live fetch failed — try disk cache
      proxyRes.resume(); // drain the response
      return serveCachedLogo(sid, cacheFile, res);
    }

    // Live fetch succeeded — collect data, cache to disk, and serve
    const contentType = proxyRes.headers['content-type'] || 'image/png';
    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const imageData = Buffer.concat(chunks);
      if (imageData.length === 0) {
        return serveCachedLogo(sid, cacheFile, res);
      }

      // Save to disk cache (async, don't block response)
      saveLogo(sid, cacheFile, imageData, contentType);

      // Serve the live image
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': imageData.length,
        'Cache-Control': 'no-cache',
        'X-Logo-Source': 'live',
      });
      res.end(imageData);
    });
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      serveCachedLogo(sid, cacheFile, res);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      serveCachedLogo(sid, cacheFile, res);
    }
  });

  req.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
});

/**
 * Serve a cached logo from disk, or 404 if no cache exists.
 */
function serveCachedLogo(sid, cacheFile, res) {
  const metaFile = cacheFile + '.meta';
  if (!fs.existsSync(cacheFile)) {
    return res.status(404).json({ error: 'No logo available' });
  }
  try {
    const imageData = fs.readFileSync(cacheFile);
    let contentType = 'image/png';
    if (fs.existsSync(metaFile)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        contentType = meta.contentType || 'image/png';
      } catch { /* use default */ }
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': imageData.length,
      'Cache-Control': 'max-age=300',
      'X-Logo-Source': 'cache',
    });
    res.end(imageData);
  } catch (err) {
    console.error(`[tuner] Failed to read cached logo for ${sid}:`, err.message);
    res.status(404).json({ error: 'No logo available' });
  }
}

/**
 * Save a logo to the persistent disk cache.
 * Compares with existing cache to avoid unnecessary writes.
 */
function saveLogo(sid, cacheFile, imageData, contentType) {
  try {
    // Skip write if file exists with same size (likely unchanged)
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      if (stat.size === imageData.length) return;
    }
    fs.writeFileSync(cacheFile, imageData);
    fs.writeFileSync(cacheFile + '.meta', JSON.stringify({ contentType, updated: Date.now() }));
    console.log(`[logo-cache] Saved logo for SID ${sid} (${imageData.length} bytes)`);
  } catch (err) {
    console.error(`[logo-cache] Failed to save logo for SID ${sid}:`, err.message);
  }
}

/**
 * GET /api/dls/:sid
 * Get the Dynamic Label Segment (now-playing text) for a service.
 * Extracts DLS, programme type, and audio level from /mux.json.
 */
router.get('/dls/:sid', async (req, res) => {
  const sid = req.params.sid;
  try {
    const mux = await dabBackend.getCurrentEnsemble();
    if (!mux || !mux.services) {
      return res.status(502).json({ error: 'No ensemble data available' });
    }

    const svc = mux.services.find(s => String(s.sid) === String(sid));
    if (!svc) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const dls = svc.dls || {};
    const mot = svc.mot || {};
    const dlsLabel = typeof dls.label === 'string' ? dls.label : (extractLabel(dls.label) || '');

    res.json({
      sid,
      dls: dlsLabel,
      dlsTime: dls.time || 0,
      dlsLastChange: dls.lastchange || 0,
      motLastChange: mot.lastchange || 0,
      pty: svc.ptystring || '',
      audioLevel: svc.audiolevel || null,
    });
  } catch (err) {
    console.error('[tuner] Failed to get DLS:', err.message);
    res.status(502).json({ error: 'Failed to get DLS', details: err.message });
  }
});

module.exports = router;
