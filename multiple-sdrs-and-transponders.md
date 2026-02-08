# Multiple RTL-SDR Devices & Transponders — Implementation Plan

## Overview

Enable the application to use **multiple RTL-SDR dongles simultaneously**, each tuned to a different DAB+ channel (transponder). This multiplies the number of available stations without requiring re-tuning. For example:

```
RTL-SDR Device 0 — Channel 11B (Sveriges Radio Stockholm)
RTL-SDR Device 2 — Channel 5B  (Teracom Mux 2)
RTL-SDR Device 1 — Channel 9A  (Teracom Mux 3)
```

All stations from all three transponders appear in a single unified station list. The user can switch between any station instantly — the system knows which device+channel combination serves each station.

---

## Current Architecture (Single-Device)

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌───────────┐
│  web-ui     │────▶│  api        │────▶│  dab-server  │────▶│ welle-cli │
│  (nginx)    │     │  (Express)  │     │  (Python)    │     │ (1 inst.) │
└─────────────┘     └─────────────┘     └──────────────┘     └───────────┘
                                              │
                                         1 rtl_tcp process
                                         1 welle-cli process
                                         1 device, 1 channel
```

### Single-Device Constraints

| Component | Constraint | Details |
|---|---|---|
| `setup.json` | Single `selected_device` object | Only one device persisted |
| `setup.json` | Single `selected_transponder` object | Only one channel persisted |
| `server.py` | Global `welle_process` / `rtl_tcp_process` | Only one welle-cli instance |
| `wizard.js` | Step 1 selects one device, Step 3 selects one transponder | Linear single-device flow |
| `app.js` | `setupData.selected_device.index` used everywhere | Hardcoded single device |

### Already Multi-Device Ready

| Component | Status | Details |
|---|---|---|
| `device-manager.js` | Ready | Per-device lock files work for N devices |
| `channel-store.js` | Ready | `channels.json` already stores scans per device |
| `scanner.js` | Ready | Can scan different devices independently |
| `tuner.js /api/tune` | Partially | Accepts `device_index` param, but dab-server limits to one |

---

## Target Architecture (Multi-Device)

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌────────────────────┐
│  web-ui     │────▶│  api        │────▶│  dab-server  │────▶│ welle-cli pool     │
│  (nginx)    │     │  (Express)  │     │  (Python)    │     │                    │
└─────────────┘     └─────────────┘     └──────────────┘     │ Device 0 → ch 11B │
                                              │               │ Device 1 → ch 9A  │
                                         N rtl_tcp processes  │ Device 2 → ch 5B  │
                                         N welle-cli processes└────────────────────┘
```

### Key Design Decision: Single dab-server, Multiple welle-cli Processes

Rather than spawning separate Docker containers per device, the dab-server Python process will manage a **pool of welle-cli instances** — one per configured device. Each instance gets its own rtl_tcp port and welle-cli HTTP port.

**Rationale:**
- Simpler deployment — no dynamic Docker containers
- Port allocation is predictable: rtl_tcp ports `1234 + device_index`, welle-cli ports `7979 + device_index`
- The API layer already passes `device_index` — it just needs to route to the correct welle-cli port
- dab-server already has the process management code; it needs to be parameterised per device

---

## Data Model Changes

### setup.json — New Schema

```json
{
  "completed": true,
  "device_configs": [
    {
      "device": { "index": 0, "serial": "00000001" },
      "channel": "11B",
      "ensemble": "Sveriges Radio Stockholm"
    },
    {
      "device": { "index": 2, "serial": "00000003" },
      "channel": "5B",
      "ensemble": "Teracom Mux 2"
    },
    {
      "device": { "index": 1, "serial": "00000002" },
      "channel": "9A",
      "ensemble": "Teracom Mux 3"
    }
  ]
}
```

**Migration:** On startup, if `selected_device` exists (old format), auto-migrate to `device_configs` array with a single entry.

### channels.json — No Change Needed

Already stores scans per `device_index`. Each device's transponder list is independent.

### New: Device-to-Port Mapping (Runtime)

The API needs to know which welle-cli port corresponds to which device:

```javascript
// Runtime state (not persisted)
activeInstances: {
  0: { wellePort: 7979, rtlTcpPort: 1234, channel: "11B", pid: 12345 },
  1: { wellePort: 7980, rtlTcpPort: 1235, channel: "9A",  pid: 12346 },
  2: { wellePort: 7981, rtlTcpPort: 1236, channel: "5B",  pid: 12347 },
}
```

---

## Implementation Phases

### Phase 1: dab-server — Process Pool

**File: `server/server.py`**

This is the most critical change. Convert from global singleton to a process pool.

#### 1a. Replace Globals with Per-Device State

Replace:
```python
welle_process = None
rtl_tcp_process = None
welle_lock = threading.Lock()
```

With:
```python
instances = {}       # device_index -> { welle_process, rtl_tcp_process, channel, welle_port, rtl_tcp_port }
instances_lock = threading.Lock()
WELLE_BASE_PORT = 7979
RTL_TCP_BASE_PORT = 1234
```

#### 1b. New Functions

```python
def start_instance(device_index, channel, gain=-1):
    """Start rtl_tcp + welle-cli for a specific device on a specific channel."""
    rtl_port = RTL_TCP_BASE_PORT + device_index
    welle_port = WELLE_BASE_PORT + device_index
    # Start rtl_tcp -d <device_index> -p <rtl_port>
    # Start welle-cli -F rtl_tcp,127.0.0.1:<rtl_port> -w <welle_port> -c <channel>
    instances[device_index] = { ... }

def stop_instance(device_index):
    """Stop a specific device's welle-cli + rtl_tcp."""

def stop_all_instances():
    """Stop all running instances."""

def get_instance(device_index):
    """Get the running instance info for a device, or None."""
```

#### 1c. Updated HTTP Endpoints

| Endpoint | Change |
|---|---|
| `POST /start` | Now starts ONE instance (device_index + channel). Can be called multiple times for different devices. Does NOT stop other instances. |
| `POST /stop` | Add optional `device_index` param. If provided, stops only that instance. If omitted, stops all. |
| `GET /mux.json` | Add `device_index` query param (default 0 for backward compat). Routes to correct welle-cli port. |
| `GET /mp3/{sid}` | Add `device_index` query param. Routes to correct welle-cli instance. |
| `GET /slide/{sid}` | Add `device_index` query param. Routes to correct welle-cli instance. |
| `POST /scan` | Already per-device. No change needed. |
| `GET /health` | Report health of all instances. |

New endpoint:
| `GET /instances` | Return status of all running welle-cli instances (device_index, channel, port, pid, uptime). |

#### 1d. Startup

```python
def start_all_configured():
    """Called on dab-server startup. Reads setup.json and starts all configured instances."""
    setup = read_setup_json()
    for config in setup.get('device_configs', []):
        start_instance(config['device']['index'], config['channel'])
```

---

### Phase 2: API — Multi-Instance Routing

**File: `api/src/services/dab-backend.js`**

#### 2a. Instance-Aware Backend

Currently `dab-backend.js` talks to a single dab-server URL. It needs to route requests to the correct welle-cli port based on device_index.

```javascript
// Map device_index to welle-cli port
function getWellePort(deviceIndex) {
    return config.WELLE_PORT + deviceIndex;
}

// Route ensemble requests to correct instance
async function getCurrentEnsemble(deviceIndex = 0) {
    const port = getWellePort(deviceIndex);
    // fetch from http://dab-server:<port>/mux.json
}

function getStreamUrl(sid, deviceIndex = 0) {
    const port = getWellePort(deviceIndex);
    return `http://${config.DAB_SERVER_HOST}:${port}/mp3/${sid}`;
}
```

#### 2b. Start/Stop Per Instance

```javascript
async function startStreaming(deviceIndex, channel, gain) {
    // POST to dab-server management API /start with device_index + channel
    // dab-server starts only the specified instance (doesn't stop others)
}

async function stopStreaming(deviceIndex) {
    // POST to dab-server management API /stop with device_index
}

async function startAllConfigured() {
    // POST to dab-server to start all configured device+channel pairs
}
```

**File: `api/src/routes/tuner.js`**

#### 2c. Updated Tuner Routes

| Route | Change |
|---|---|
| `POST /api/tune` | No structural change — already accepts `device_index` |
| `GET /api/current` | Add `?device_index=N` query param. Returns ensemble for specific instance. |
| `GET /api/current/all` | **New.** Returns ensemble data for ALL active instances in one response. |
| `GET /api/stream/:sid` | Add `?device_index=N` query param. Proxy from correct welle-cli port. |
| `GET /api/slide/:sid` | Add `?device_index=N` query param. Try live from correct instance, then disk cache. |
| `GET /api/dls/:sid` | Add `?device_index=N` query param. Fetch from correct instance's mux.json. |

#### 2d. New Route: Active Instances

```
GET /api/instances
Response: [
  { device_index: 0, serial: "00000001", channel: "11B", ensemble: "SR Stockholm", welle_port: 7979, status: "running" },
  { device_index: 1, serial: "00000002", channel: "9A",  ensemble: "Teracom 3",    welle_port: 7980, status: "running" },
  ...
]
```

**File: `api/src/services/setup-store.js`**

#### 2e. Setup Store Migration

```javascript
function getSetupStatus() {
    const data = readSetupFile();

    // Backward compatibility: migrate old single-device format
    if (data.selected_device && !data.device_configs) {
        data.device_configs = [{
            device: data.selected_device,
            channel: data.selected_transponder ? data.selected_transponder.channel : null,
            ensemble: data.selected_transponder ? data.selected_transponder.ensemble_label : null,
        }];
    }

    return data;
}

function completeSetup(deviceConfigs) {
    // deviceConfigs: [{ device: { index, serial }, channel, ensemble }, ...]
    writeSetupFile({
        completed: true,
        device_configs: deviceConfigs,
    });
}
```

---

### Phase 3: Setup Wizard — Multi-Device Flow

**File: `web/public/js/wizard.js`**

Redesign the wizard to support selecting multiple devices and binding each to a channel.

#### New Wizard Flow

```
Step 1: Device Detection
  ├─ Probe USB devices → show list
  ├─ User sees all available RTL-SDR dongles
  └─ (No selection yet — just detection)

Step 2: Channel Scanning
  ├─ "Scan all devices" button → scans ALL detected devices in parallel
  ├─ Progress shown per device
  ├─ Each device scans the full DAB band
  └─ Results stored per device in channels.json

Step 3: Device-to-Channel Binding
  ├─ Show all detected devices in a table/card layout
  ├─ For each device, show a dropdown of available channels (from scan results)
  ├─ User selects which channel each device should tune to:
  │
  │   ┌──────────────────────────────────────────────────┐
  │   │  RTL-SDR Device 0 (serial: 00000001)            │
  │   │  Channel: [▼ 11B — Sveriges Radio Stockholm   ] │
  │   ├──────────────────────────────────────────────────┤
  │   │  RTL-SDR Device 1 (serial: 00000002)            │
  │   │  Channel: [▼ 9A — Teracom Mux 3               ] │
  │   ├──────────────────────────────────────────────────┤
  │   │  RTL-SDR Device 2 (serial: 00000003)            │
  │   │  Channel: [▼ 5B — Teracom Mux 2               ] │
  │   └──────────────────────────────────────────────────┘
  │
  ├─ Validation: same channel can't be assigned to two devices
  ├─ A device can be left unassigned (disabled/skipped)
  └─ "Complete Setup" saves all bindings to setup.json

Step 4 (optional): Manual Channel Entry
  ├─ For users who skip scanning
  ├─ Same binding UI but channels entered manually per device
  └─ Triggers tune-discover per device to validate
```

#### Step 3 Details: Binding UI

The channel dropdown for each device should show:
- All unique channels found across ALL device scans (union of results)
- Each entry: `"11B — Sveriges Radio Stockholm (6 stations)"`
- Channels already assigned to another device are greyed out / marked
- Option: "— Not used —" to skip a device

#### Wizard State

```javascript
// Replace single selectedDevice/selectedTransponder with:
let detectedDevices = [];      // from /api/devices
let deviceBindings = [];       // [{ device: {...}, channel: "11B", ensemble: "..." }, ...]
```

---

### Phase 4: Frontend — Unified Multi-Transponder Station List

**File: `web/public/js/app.js`**

#### 4a. Load Channels from All Configured Devices

Replace:
```javascript
const result = await api.getChannelsForDevice(deviceIndex);
```

With:
```javascript
// Load channels for ALL configured devices
const allTransponders = [];
for (const config of setupData.device_configs) {
    const result = await api.getChannelsForDevice(config.device.index);
    const transponders = result.transponders || result.channels || result || [];
    // Tag each transponder with its device info
    transponders.forEach(tp => {
        tp._deviceIndex = config.device.index;
        tp._deviceSerial = config.device.serial;
    });
    allTransponders.push(...transponders);
}
loadChannels(allTransponders, null);
```

#### 4b. Station Selection with Device Routing

```javascript
function onStationSelect(sid, stationName, transponder) {
    // transponder now carries _deviceIndex from the tagged data
    const deviceIndex = transponder._deviceIndex;
    const deviceSerial = transponder._deviceSerial;

    updateNowPlaying({
        sid,
        stationName,
        ensemble: getEnsembleLabel(transponder),
        channel: transponder.channel,
        bitrate: findServiceBitrate(sid, transponder),
        codec: findServiceCodec(sid, transponder),
        deviceName: deviceSerial || `Device #${deviceIndex}`,
        deviceIndex,   // NEW: track which device this station uses
    });

    setActiveStation(sid);
    play(sid, stationName, deviceIndex);  // Pass device index to player
}
```

**File: `web/public/js/channels.js`**

#### 4c. Station List Grouping Options

With multiple transponders, the station list grows significantly. Options:

**Option A: Flat alphabetical list (recommended for simplicity)**
- All stations from all transponders in one alphabetically sorted list
- Each station item subtly shows which transponder/channel it's on
- Current approach scales naturally — just more items

**Option B: Grouped by transponder**
```
▼ Sveriges Radio Stockholm (11B)
    P1, P2, P3, P4, SR Klassiskt...

▼ Teracom Mux 2 (5B)
    Mix Megapol, NRJ, Rock Klassiker...

▼ Teracom Mux 3 (9A)
    Star FM, Rix FM, Lugna Favoriter...
```

**Recommendation:** Default to flat alphabetical (consistent with current behavior), but add a toggle to switch to grouped view. The transponder section in the sidebar already lists all transponders — clicking one could filter the station list.

#### 4d. Transponder Filtering

The existing transponder list in the sidebar currently just highlights. Enhance it to:
- Show which device each transponder is bound to (e.g. "11B · Device 0")
- Clicking a transponder filters the station list to that transponder's stations
- Clicking again (or clicking "All") shows all stations
- Show a status indicator (green dot if device is running, red if not)

**File: `web/public/js/player.js`**

#### 4e. Player — Device-Aware Streaming

```javascript
export function play(sid, stationName = null, deviceIndex = 0) {
    currentSid = sid;
    currentStationName = stationName;
    currentDeviceIndex = deviceIndex;
    state = 'loading';
    // Stream URL includes device_index for routing
    audioEl.src = `/stream/${sid}?device_index=${deviceIndex}`;
    audioEl.load();
    render();
    // ... buffering logic unchanged
}
```

**File: `web/public/js/nowplaying.js`**

#### 4f. DLS and Logo Polling with Device Index

```javascript
// pollDls needs to pass device_index to the API
const data = await getDLS(sid, deviceIndex);

// Logo fetch needs device_index
const blobUrl = await fetchAndCacheLogo(sid, deviceIndex);
```

**File: `web/public/js/api.js`**

#### 4g. API Client Updates

All endpoints that need device routing get an optional `deviceIndex` parameter:

```javascript
export async function getDLS(sid, deviceIndex = 0) {
    return request('GET', `/dls/${sid}?device_index=${deviceIndex}`);
}

export async function getCurrentInfo(deviceIndex = 0) {
    return request('GET', `/current?device_index=${deviceIndex}`);
}

export async function getInstances() {
    return request('GET', '/instances');
}
```

**File: `web/nginx.conf.template`**

#### 4h. Nginx — Pass Query Params

Ensure all proxy locations pass query parameters through (they already do with `proxy_pass` — query strings are forwarded by default).

The `/stream/` location needs the `device_index` query param forwarded to the API:
```nginx
location /stream/ {
    proxy_pass http://api:${API_PORT}/api/stream/;
    # Query params like ?device_index=1 are forwarded automatically
    ...
}
```

---

### Phase 5: Auto-Tune on Startup

**File: `api/src/index.js`**

#### 5a. Start All Configured Instances

Replace:
```javascript
async function autoTuneOnStartup() {
    // Starts ONE device on ONE channel
    await dabBackend.startStreaming(deviceIndex, channel);
}
```

With:
```javascript
async function autoTuneOnStartup() {
    const setup = setupStore.getSetupStatus();
    if (!setup.completed || !setup.device_configs) return;

    for (const config of setup.device_configs) {
        try {
            await dabBackend.startStreaming(
                config.device.index,
                config.channel
            );
            console.log(`[startup] Started device ${config.device.index} on channel ${config.channel}`);
        } catch (err) {
            console.error(`[startup] Failed to start device ${config.device.index}:`, err.message);
        }
    }
}
```

---

### Phase 6: Status Bar & Settings

**File: `web/public/js/app.js`**

#### 6a. Status Bar — Show All Active Devices

Replace single device display with multi-device status:

```html
<div class="status-bar-item" id="status-devices">
    Device 0: 11B · Device 1: 9A · Device 2: 5B
</div>
```

Or a compact format:
```html
<span>3 devices active</span>
```

#### 6b. Settings Panel — Per-Device Gain

The current settings panel allows setting gain globally. With multiple devices, each device may need its own gain:

```html
<div class="settings-device">
    <h4>Device 0 (00000001) — Channel 11B</h4>
    <select id="gain-device-0">...</select>
</div>
<div class="settings-device">
    <h4>Device 1 (00000002) — Channel 9A</h4>
    <select id="gain-device-1">...</select>
</div>
```

---

### Phase 7: Docker & Port Allocation

**File: `docker-compose.yml`**

#### 7a. Expose Port Range

Currently only one welle-cli port is used. With multiple instances, we need a range:

```yaml
dab-server:
    environment:
      - WELLE_BASE_PORT=${WELLE_BASE_PORT:-7979}
      - MAX_DEVICES=${MAX_DEVICES:-4}
    # No extra port exposure needed — all internal to dab-net
```

Since all welle-cli ports are internal to the Docker network (dab-server container), no external port mapping is needed. The API container accesses them via the Docker bridge network.

#### 7b. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WELLE_BASE_PORT` | 7979 | Base port for welle-cli instances (device N uses base+N) |
| `RTL_TCP_BASE_PORT` | 1234 | Base port for rtl_tcp instances (device N uses base+N) |
| `MAX_DEVICES` | 4 | Maximum concurrent RTL-SDR devices |

---

## Migration & Backward Compatibility

### setup.json Migration

On first load with the new code:
1. Read `setup.json`
2. If `selected_device` exists (old format):
   - Convert to `device_configs` array with one entry
   - Preserve all data
   - Write updated format
3. Old fields (`selected_device`, `selected_transponder`) are removed

### API Backward Compatibility

All existing API endpoints remain functional with default `device_index=0`:
- `GET /api/current` → defaults to device 0
- `GET /api/stream/:sid` → defaults to device 0
- `POST /api/tune { device_index: 0, channel: "11B" }` → unchanged

### Frontend Graceful Handling

If only one device is configured, the UI behaves identically to the current single-device experience:
- Wizard shows one device
- Station list shows one transponder's stations
- No visual clutter from multi-device features

---

## Edge Cases & Considerations

### Same Station on Multiple Transponders

Some stations broadcast on multiple channels. When the station list is merged:
- Deduplicate by SID? No — different transponders may have different bitrates/codecs
- Show both entries with the transponder/channel as a differentiator
- Or: show one entry, prefer the higher-bitrate version

### Device Hot-Plug

RTL-SDR devices can be unplugged:
- dab-server should detect process crashes and report device status
- API `/instances` endpoint shows which devices are running vs failed
- UI shows device status indicators (green/red dot per device)

### Scanning While Streaming

With multiple devices, one device could be scanning while others stream:
- Device locks already prevent concurrent scan+stream on the same device
- Scanning device 0 while streaming on device 1 should work
- UI should warn if user tries to scan a device that's currently streaming

### Resource Limits

Each welle-cli instance uses:
- ~50-100MB RAM
- ~10-15% CPU on ARM (Raspberry Pi)
- One USB bus slot

For a Raspberry Pi 4 (4GB RAM), 3-4 simultaneous instances should be manageable.

---

## Implementation Order

| Priority | Phase | Effort | Description |
|---|---|---|---|
| 1 | Phase 1 | Large | dab-server process pool (most critical, unlocks everything) |
| 2 | Phase 2e | Small | Setup store migration (data model foundation) |
| 3 | Phase 2a-d | Medium | API multi-instance routing |
| 4 | Phase 5 | Small | Auto-tune all on startup |
| 5 | Phase 3 | Large | Wizard redesign (device-to-channel binding UI) |
| 6 | Phase 4a-b | Medium | Frontend: load all channels, device-aware selection |
| 7 | Phase 4c-d | Medium | Frontend: station list grouping, transponder filtering |
| 8 | Phase 4e-h | Medium | Frontend: player, DLS, logos, API client updates |
| 9 | Phase 6 | Small | Status bar and settings updates |
| 10 | Phase 7 | Small | Docker/environment config |

---

## Files Modified

| File | Change Scope |
|---|---|
| `server/server.py` | Major rewrite — process pool instead of global singleton |
| `api/src/services/setup-store.js` | New `device_configs` schema + migration |
| `api/src/services/dab-backend.js` | Instance-aware routing (port per device) |
| `api/src/routes/tuner.js` | `device_index` query params on all endpoints |
| `api/src/routes/setup.js` | Accept `device_configs` array |
| `api/src/index.js` | Auto-tune all configured instances on startup |
| `api/src/config.js` | `WELLE_BASE_PORT`, `MAX_DEVICES` |
| `web/public/js/wizard.js` | Major rewrite — multi-device binding flow |
| `web/public/js/app.js` | Load channels from all devices, device-aware selection |
| `web/public/js/channels.js` | Grouped/filtered station list, device indicators |
| `web/public/js/player.js` | Device-aware streaming URL |
| `web/public/js/nowplaying.js` | Pass device_index to DLS/logo polling |
| `web/public/js/api.js` | `device_index` param on all relevant functions |
| `web/nginx.conf.template` | No structural changes (query params forwarded) |
| `docker-compose.yml` | New environment variables |
