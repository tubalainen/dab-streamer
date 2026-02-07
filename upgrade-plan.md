# DAB+ Radio Streamer — v1.0 Upgrade Plan

## Context

The dab-streamer project is a working Dockerized DAB+ radio receiver with a 3-step setup wizard and radio player UI. The user has confirmed the core functionality works and wants 8 upgrades for v1.0. These range from quick UX fixes to a significant new wizard flow.

---

## Implementation Order

| Phase | Upgrades | Rationale |
|-------|----------|-----------|
| **Phase 1: Quick Fixes** | #8, #2, #7 | Simple, self-contained, no dependencies |
| **Phase 2: Data Layer** | #4 | Filter non-audio services (needed before #1) |
| **Phase 3: Layout & Audio** | #5, #6 | CSS grid restructure + audio buffering |
| **Phase 4: Features** | #3, #1 | Station logo + manual channel selection |

---

## Upgrade #8 — Fix "No Devices Detected" Flash

**Problem:** `initWizard()` calls `render()` synchronously before `loadDevices()` resolves, briefly showing the empty state.

**Files:** `web/public/js/wizard.js`

**Changes:**
- Add `let devicesLoading = true;` state variable
- Set `devicesLoading = true` before API call in `loadDevices()`, `false` after (success & error)
- In `renderStep1()`: before the `devices.length === 0` check, add a `devicesLoading` check that shows a spinner + "Detecting RTL-SDR devices..." message (reuse existing `.spinner .spinner-lg` CSS classes)

---

## Upgrade #2 — Fix "Service 0xe254" → Show Station Name

**Problem:** `player.js` line 133 displays `Service ${currentSid}` because it has no access to the station name.

**Files:** `web/public/js/player.js`, `web/public/js/app.js`

**Changes in `player.js`:**
- Add `let currentStationName = null;` state variable
- Modify `play(sid)` → `play(sid, stationName = null)`, store `currentStationName`
- Add export `setStationName(name)` for reconnect scenarios (page load with active stream)
- In `stop()`: clear `currentStationName`
- In `render()` line 133: display `currentStationName || (currentSid ? \`Service ${currentSid}\` : 'No station selected')`

**Changes in `app.js`:**
- Update import to include `setStationName`
- In `onStationSelect()` line 231: pass stationName to `play(sid, stationName)`
- In `onStationInfoLoaded()`: call `setStationName(name)` to update player when recovering playback state on page load

---

## Upgrade #7 — "Reset Configuration" with Confirmation Modal

**Problem:** Button says "Setup", uses native `confirm()` dialog, and doesn't clearly warn the user.

**Files:** `web/public/js/app.js`, `web/public/css/components.css`

**Changes in `app.js`:**
- Rename button text from "Setup" to "Reset Configuration" (line 64-66)
- Add styled confirmation modal HTML alongside the settings panel (inside `.radio-container`)
- Replace `confirm()` call (lines 153-163) with modal show/hide logic
- Modal has: title, descriptive message, Cancel + red Reset buttons
- Reset button calls `stop()` → `api.resetSetup()` → `window.location.reload()` (existing logic, already releases device locks via backend)

**Changes in `components.css`:**
- Add `.confirm-modal`, `.confirm-overlay`, `.confirm-content`, `.confirm-actions` styles (similar pattern to existing `.settings-panel` styles)

---

## Upgrade #4 — Filter Non-Audio Services

**Problem:** Non-audio services (SPI, EPG, TPEG) appear in the station list. These have `transportmode: "Stream"` in their welle-cli component data.

**Files:** `server/scan.sh`, `web/public/js/channels.js`, `web/public/js/wizard.js`

**Changes in `scan.sh` (line 195):**
- Add `select(.components[0].transportmode == "Audio")` filter in the jq pipeline
- Also extract `transportmode` field into the service object for frontend safety

**Changes in `channels.js`:**
- Add `filterAudioServices(services)` helper that removes services where `transportmode` exists and is not `"Audio"` (missing field = assume audio, for backward compat with old scan data)
- Use in `render()` when iterating services and computing `totalServices`

**Changes in `wizard.js`:**
- Apply same filter in `renderStep3()` when rendering transponder card service lists (line 368)
- Update service count display to use filtered count

---

## Upgrade #5 — Move Player to Bottom (Full Width)

**Problem:** Player controls are inside `.main-content` (right column only). Should span full width above status bar.

**Files:** `web/public/js/app.js`, `web/public/css/layout.css`, `web/public/css/variables.css`

**Changes in `variables.css`:**
- Add `--player-height: 72px;`

**Changes in `app.js` `initRadioMode()`:**
- Move `<div class="player-controls" id="player-container"></div>` out of `.main-content` to be a direct child of `.radio-container`, between `.main-content` and the settings panel

**Changes in `layout.css`:**
- Update grid template: add `player` row between `main` and `status`
  ```
  grid-template-rows: var(--header-height) 1fr var(--player-height) var(--status-bar-height);
  grid-template-areas:
      "header header"
      "sidebar main"
      "player player"
      "status status";
  ```
- Update `.player-controls` to use `grid-area: player;` (full-width spanning)
- Update responsive breakpoint at 768px to include `"player"` row

---

## Upgrade #6 — Increase Audio Buffer

**Problem:** Audio playback sometimes chops out due to insufficient buffering.

**Files:** `web/public/js/player.js`, `server/server.py`

**Changes in `player.js` `play()` function:**
- Set `audioEl.preload = 'auto'` (currently `'none'`)
- Instead of calling `audioEl.play()` immediately after `load()`, wait for the `canplaythrough` event (browser signals sufficient buffer)
- Add a 2-second fallback timeout in case `canplaythrough` never fires (common for live streams)
- Clean up event listener/timeout properly

**Changes in `server.py` (line 292):**
- Increase read chunk size from `4096` to `16384` bytes for reduced overhead on streaming proxy

---

## Upgrade #3 — Station Logo in Now Playing

**Problem:** No station logo/artwork is shown. welle-cli provides MOT/slideshow images via `GET /slide/{sid}`.

**Files:** `server/server.py`, `api/src/routes/tuner.js`, `web/nginx.conf.template`, `web/public/js/nowplaying.js`, `web/public/js/app.js`, `web/public/css/layout.css`

**Backend — Slide proxy chain:**

1. **`server/server.py`** — Add `/slide/` handler in `do_GET` (before the catch-all welle-cli proxy). Fetch from `http://localhost:{WELLE_PORT}/slide/{sid}`, return binary image data with appropriate Content-Type. Return 404 if no slide available.

2. **`api/src/routes/tuner.js`** — Add `GET /api/slide/:sid` route. HTTP proxy to `dab-server:8888/slide/{sid}`, pipe response. Handle 404 gracefully.

3. **`web/nginx.conf.template`** — Add `/slide/` location block proxying to `api:${API_PORT}/api/slide/`

**Frontend:**

4. **`app.js`** — Include `sid` in the info object passed to `updateNowPlaying()` in both `onStationSelect()` and `onStationInfoLoaded()`

5. **`nowplaying.js`** — Add logo display:
   - Define an SVG fallback radio icon constant
   - In `render()`: add `.now-playing-logo` container above the station name, initially showing the fallback SVG
   - Add `loadLogo(sid)` function: create an `Image()`, set `src=/slide/{sid}?t={timestamp}`, on success replace fallback with `<img>`, on error keep fallback
   - Call `loadLogo()` on each `render()` when a station is active

6. **`layout.css`** — Add styles: `.now-playing-logo` (120x120 rounded container), `.now-playing-logo-img` (object-fit cover), `.now-playing-logo-fallback` (muted icon)

---

## Upgrade #1 — Manual Channel Selection (Skip Scanning)

**Problem:** Users who know their DAB channel (e.g., "12C") must still scan all 38 channels. They should be able to select a known channel and skip scanning.

**Files:** `web/public/js/wizard.js`, `web/public/js/api.js`, `web/public/css/wizard.css`, `api/src/routes/tuner.js`

**Backend — `POST /api/tune-discover` endpoint (`tuner.js`):**
- Accepts `{ device_index, channel }`
- Calls `dabBackend.startStreaming(idx, channel)` to tune
- Polls `dabBackend.getCurrentEnsemble()` up to 15 seconds for service discovery
- Filters to audio-only services (using `transportmode`)
- Builds a transponder object matching scan.sh format
- Saves to `channelStore` for radio mode to use
- Returns `{ success, channel, transponder }` or error

**Frontend API (`api.js`):**
- Add `tuneAndDiscover(deviceIndex, channel)` → `POST /tune-discover`

**Wizard UI (`wizard.js`):**

- Add state: `manualChannel`, `manualDiscovering`, `manualResult`
- Add constant: `DAB_CHANNELS` array (5A through 13F, 38 entries)

- **Step 1 modification:** Below the device cards, add a divider ("or select a known channel") and a row with:
  - Channel dropdown (`<select>`) with all 38 DAB channels
  - "Use This Channel" button (disabled until device + channel selected)
  - The existing "Scan Channels →" button remains unchanged

- **"Use This Channel" click handler** (`startManualDiscovery()`):
  - Set `manualDiscovering = true`, jump to step 3
  - Call `api.tuneAndDiscover(device.index, channel)`
  - On success: store transponder in `transponders[]`, auto-select it
  - On failure: show error state with option to try different channel or go back

- **Step 3 modifications:**
  - If `manualDiscovering`: show spinner + "Discovering services on channel X..."
  - If `manualResult` with error: show "No services found" with instructions
  - Otherwise: existing transponder card display (works for both scan and manual results)

- **Navigation adjustments:**
  - Back button from step 3 goes to step 1 (not step 2) when in manual mode
  - Step indicator: mark step 2 as "completed" (checkmark) when manual mode is used

**CSS (`wizard.css`):**
- `.manual-channel-section` — margin top
- `.manual-channel-divider` — horizontal line with centered text
- `.manual-channel-row` — flex row for dropdown + button

---

## File Change Matrix

| File | Upgrades |
|------|----------|
| `web/public/js/wizard.js` | #1, #4, #8 |
| `web/public/js/player.js` | #2, #6 |
| `web/public/js/app.js` | #2, #3, #5, #7 |
| `web/public/js/nowplaying.js` | #3 |
| `web/public/js/channels.js` | #4 |
| `web/public/js/api.js` | #1 |
| `web/public/css/layout.css` | #3, #5 |
| `web/public/css/components.css` | #7 |
| `web/public/css/variables.css` | #5 |
| `web/public/css/wizard.css` | #1 |
| `web/nginx.conf.template` | #3 |
| `api/src/routes/tuner.js` | #1, #3 |
| `server/server.py` | #3, #6 |
| `server/scan.sh` | #4 |

---

## Verification

After implementing all upgrades, test end-to-end:

1. `docker compose build && docker compose up`
2. **#8:** Open wizard — should see spinner "Detecting..." instead of "No Devices"
3. **#1:** In wizard step 1, select device, pick channel from dropdown, click "Use This Channel" → should discover services and show step 3 without scanning
4. **#4:** SPI and non-audio services should not appear anywhere (wizard step 3, radio sidebar)
5. **#2:** Play a station — player bar should show station name, not "Service 0xe254"
6. **#3:** Now playing area should show station logo (or radio icon fallback)
7. **#5:** Player controls should span full width at the bottom
8. **#6:** Audio should buffer briefly before starting (less choppy)
9. **#7:** Click "Reset Configuration" → styled modal appears, confirm → redirects to wizard
