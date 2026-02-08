# Dynamic Label (DLS) — "Now Playing" Text Plan

## Background

In FM radio, RDS (Radio Data System) provides "now playing" text. In DAB+, the equivalent feature is **DLS (Dynamic Label Segment)**, part of the **PAD (Programme Associated Data)** system. DLS carries up to 128 characters of UTF-8 text, typically showing the current song artist/title, programme name, or promotional messages. It updates every 5-30 seconds depending on the broadcaster.

## Data Availability in welle-cli

welle-cli **already exposes DLS** via the `/mux.json` endpoint. No new welle-cli endpoints are needed.

### `/mux.json` Service Object (relevant fields)

```json
{
  "services": [
    {
      "sid": "0xe254",
      "label": { "label": "STAR FM" },
      "programType": 10,
      "ptystring": "Pop Music",
      "dls": {
        "label": "Adele - Rolling In The Deep",
        "time": 1707400000,
        "lastchange": 1707399950
      },
      "mot": {
        "time": 1707400000,
        "lastchange": 1707399900
      },
      "audiolevel": {
        "time": 1707400000,
        "left": -12.5,
        "right": -11.8
      },
      "components": [ ... ]
    }
  ]
}
```

### Key Fields

| Field | Description |
|---|---|
| `dls.label` | The dynamic text string (artist/title, programme info, etc.) |
| `dls.time` | Unix timestamp — when the DLS was last received |
| `dls.lastchange` | Unix timestamp — when the DLS text actually changed (new content) |
| `ptystring` | Programme type name (e.g., "Pop Music", "News", "Sport") — static per service |
| `audiolevel.left` / `.right` | Current audio level in dB (real-time) |

### Important Constraint

DLS is **only populated for services that are currently being decoded** (i.e., someone is streaming audio via `/mp3/{sid}`). Services that nobody is listening to will have empty DLS fields. Since our application streams one station at a time, only the active station will have DLS data — which is exactly what we want to display.

## Current Architecture

```
Browser → nginx /api/* → API (Express) → dab-server (Python) → welle-cli
```

The API already has `GET /api/current` which calls `dabBackend.getCurrentEnsemble()` → fetches `/mux.json` from dab-server. This endpoint returns the full mux.json response including the `dls` field. **The data path already exists — we just need to poll it from the frontend and display it.**

## Implementation Plan

### Phase 1: API — Add DLS Endpoint

**File: `api/src/routes/tuner.js`**

Add a lightweight `GET /api/dls/:sid` endpoint that fetches `/mux.json`, finds the matching service, and returns only the DLS data:

```javascript
GET /api/dls/:sid
Response: {
  "sid": "0xe254",
  "dls": "Adele - Rolling In The Deep",
  "dlsTime": 1707400000,
  "dlsLastChange": 1707399950,
  "pty": "Pop Music",
  "audioLevel": { "left": -12.5, "right": -11.8 }
}
```

This avoids sending the entire mux.json to the frontend on every poll. The endpoint:
1. Calls `dabBackend.getCurrentEnsemble()`
2. Finds the service matching `:sid` in the services array
3. Extracts and returns `dls.label`, `dls.time`, `dls.lastchange`, `ptystring`, and `audiolevel`
4. Returns `404` if the service is not found or has no DLS

**File: `web/nginx.conf.template`**

Add `/dls/` proxy location block (same pattern as `/slide/`):

```
location /dls/ {
    proxy_pass http://api:${API_PORT}/api/dls/;
    ...
}
```

### Phase 2: Frontend API Client

**File: `web/public/js/api.js`**

Add `getDLS(sid)` function:

```javascript
export async function getDLS(sid) {
    const res = await fetch(`/dls/${sid}`);
    if (!res.ok) return null;
    return res.json();
}
```

### Phase 3: Now Playing — Display DLS Text

**File: `web/public/js/nowplaying.js`**

Add a DLS polling mechanism:

1. Add a `dlsInterval` timer variable and a `currentDlsText` state
2. When a station is active, start polling `api.getDLS(sid)` every 3 seconds
3. When the station changes or clears, stop the interval
4. Display the DLS text below the station name in a new `.now-playing-dls` element
5. Only update the DOM when `dlsLastChange` differs from the previous value (avoid unnecessary flicker)
6. Add a subtle fade-in animation when the text changes

**Render structure update:**

```html
<div class="now-playing">
    <div class="now-playing-logo" id="now-playing-logo">...</div>
    <div class="now-playing-label">Now Playing</div>
    <div class="now-playing-station">STAR FM</div>
    <div class="now-playing-dls" id="now-playing-dls">
        Adele - Rolling In The Deep
    </div>
    <div class="now-playing-ensemble">Sveriges Radio Stockholm</div>
    <div class="now-playing-meta">...</div>
</div>
```

When no DLS is available, the `.now-playing-dls` element is hidden or shows nothing.

### Phase 4: CSS Styling

**File: `web/public/css/layout.css`**

Add styles for the DLS display:

```css
.now-playing-dls {
    font-size: 16px;
    color: var(--text-secondary);
    margin-bottom: var(--space-3);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-height: 24px;  /* Reserve space to prevent layout shift */
    transition: opacity var(--transition-default);
}

.now-playing-dls.fade {
    opacity: 0;
}
```

Responsive adjustments:
- At ≤768px: reduce font-size to 14px
- At ≤480px: reduce font-size to 13px

### Phase 5: Player Bar — Optional DLS Ticker

**File: `web/public/js/player.js`**

Optionally show a condensed DLS line in the player bar below the station name:

```html
<div class="player-info">
    <div class="player-info-station">STAR FM</div>
    <div class="player-info-status playing">
        Adele - Rolling In The Deep
    </div>
</div>
```

When DLS is available and the player is in "Playing" state, replace the static "Playing" text with the DLS text. When DLS is empty, fall back to "Playing".

This requires `nowplaying.js` or `app.js` to pass the DLS text to the player module.

---

## Files Modified

| File | Change |
|---|---|
| `api/src/routes/tuner.js` | New `GET /api/dls/:sid` endpoint |
| `web/nginx.conf.template` | New `/dls/` proxy location |
| `web/public/js/api.js` | New `getDLS(sid)` function |
| `web/public/js/nowplaying.js` | DLS polling, display, and fade animation |
| `web/public/js/player.js` | Show DLS in player bar status line |
| `web/public/js/app.js` | Wire DLS data between nowplaying and player |
| `web/public/css/layout.css` | `.now-playing-dls` styles + responsive |

---

## Polling Strategy

| Approach | Interval | Rationale |
|---|---|---|
| Frontend polls `/dls/{sid}` | Every 3 seconds | DLS changes every 5-30s; 3s balances freshness vs network load |
| Only poll when playing | — | Stop polling on stop/pause to avoid unnecessary requests |
| Track `dlsLastChange` | — | Only update DOM when content actually changes |

The `/dls/{sid}` endpoint is lightweight (fetches mux.json, extracts one service's DLS). At 3-second intervals with a single client, this adds negligible load to welle-cli.

---

## Data Flow

```
welle-cli                    dab-server        API              Frontend
   |                            |                |                  |
   |  DAB FIC/PAD decoder       |                |                  |
   |  updates DLS in memory     |                |                  |
   |                            |                |                  |
   |  GET /mux.json  <---------|-- proxy -------|-- GET /dls/sid --|
   |  {services:[{dls:{...}}]} |                |                  |
   |                            |                |  {dls:"...",     |
   |                            |                |   pty:"...",     |
   |                            |                |   audioLevel:{}  |
   |                            |                |  }               |
   |                            |                |                  |
   |                            |                |      nowplaying.js polls
   |                            |                |      every 3 seconds
```

---

## Future Enhancements

1. **Audio level meter**: The `audiolevel` field provides real-time L/R dB levels. Could be displayed as a small VU meter in the player bar or now-playing area.

2. **MOT slideshow rotation**: The `mot.lastchange` timestamp can detect when the station sends a new slideshow image (not just the logo). Some stations send album art or programme-related images that change with DLS.

3. **Programme type badge**: Display the `ptystring` (e.g., "Pop Music", "News") as a coloured badge next to the station name in the sidebar.

4. **DLS history**: Keep a scrollable log of recent DLS messages (useful for seeing what songs were played).
