# dab-streamer - Project Plan

## Overview

A Dockerized web application that receives DAB+ radio via one or more RTL-SDR dongles, scans for available stations, and streams them to a web browser. The system manages multiple RTL-SDR devices with exclusive locking to prevent conflicts.

**On first startup**, the user is guided through a setup wizard:
1. Select an RTL-SDR device.
2. Scan for DAB+ channels/transponders. Select which transponder to use (with full service listing per transponder).
3. Save the configuration and enter the main radio UI.

The wizard can be restarted at any time from the main UI to reconfigure from scratch.

**Design Principles:**
- **Modularity** — Single-responsibility components, well-defined interfaces, independently replaceable.
- **Multi-Device Aware** — RTL-SDR devices are a managed resource pool with exclusive locking.
- **Wizard-Driven Setup** — First-run experience guides the user step-by-step; persistent config tracks setup state.

---

## Architecture

```
                           Docker Compose Stack
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │  ┌────────────────────────────────────────────────────────────────┐  │
 │  │  dab-core (welle-cli base image, multi-stage build)            │  │
 │  │  Shared by: dab-server                                         │  │
 │  └────────────────────────────────────────────────────────────────┘  │
 │        ▲                                                             │
 │        │ FROM                                                        │
 │  ┌─────┴────────┐                                                    │
 │  │  dab-server   │                                                   │
 │  │  (welle-cli)  │                                                   │
 │  │  HTTP :7979   │                                                   │
 │  └──────┬───────┘                                                    │
 │         │                                                            │
 │         │  reads/writes                                               │
 │         ▼                                                            │
 │  ┌───────────────────────────────────────────┐                       │
 │  │  volume: dab-data                         │                       │
 │  │  /data/setup.json      (setup state)      │                       │
 │  │  /data/devices.json    (device registry)  │                       │
 │  │  /data/channels.json   (scan results)     │                       │
 │  │  /data/locks/          (device locks)     │                       │
 │  └───────────────────┬───────────────────────┘                       │
 │                      │ reads/writes                                   │
 │                      ▼                                                │
 │  ┌────────────────────────────────┐    ┌──────────────────────────┐  │
 │  │  api                           │    │  web-ui                  │  │
 │  │  (Node.js / Express)           │    │  (nginx)                 │  │
 │  │  :3000                         │    │  :8080 (host-exposed)    │  │
 │  │                                │    │                          │  │
 │  │  Modules:                      │    │  Routes:                 │  │
 │  │   ├─ routes/                   │    │   / ──> static files     │  │
 │  │   │   ├─ setup.js              │    │   /api/ ──> api:3000     │  │
 │  │   │   ├─ devices.js            │    │   /stream/ ──> api:3000  │  │
 │  │   │   ├─ channels.js           │    │                          │  │
 │  │   │   ├─ tuner.js              │    └──────────────────────────┘  │
 │  │   │   ├─ scanner.js            │                                  │
 │  │   │   └─ health.js             │                                  │
 │  │   └─ services/                 │                                  │
 │  │       ├─ setup-store.js        │                                  │
 │  │       ├─ device-manager.js     │                                  │
 │  │       ├─ dab-backend.js        │                                  │
 │  │       ├─ channel-store.js      │                                  │
 │  │       └─ scanner.js            │                                  │
 │  └────────────────────────────────┘                                  │
 │                                                                      │
 │  Network: dab-net (bridge, all services attached)                    │
 └──────────────────────────────────────────────────────────────────────┘
         │
    /dev/bus/usb (all RTL-SDR dongles passthrough)
```

---

## Setup Wizard

### Concept

The application has two UI modes controlled by persistent setup state:

- **Wizard mode** — Shown when `setup.json` does not exist or `setup.completed === false`. Guides the user through device selection, scanning, transponder selection, and saving.
- **Radio mode** — Shown when `setup.completed === true`. The main listening UI with station list, player, and device info.

A **"Restart Setup"** button in the radio mode UI resets `setup.json` and reloads into wizard mode.

### Wizard Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  Step 1: DEVICE SELECTION                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Welcome to DAB+ Radio Streamer                               │  │
│  │                                                               │  │
│  │  Select an RTL-SDR device to use:                             │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────┐                  │  │
│  │  │ ● Device 0 — Generic RTL2832U           │                  │  │
│  │  │   Serial: 00000001                      │                  │  │
│  │  │   Product: RTL2838UHIDIR                │                  │  │
│  │  └─────────────────────────────────────────┘                  │  │
│  │  ┌─────────────────────────────────────────┐                  │  │
│  │  │ ○ Device 1 — Generic RTL2832U           │                  │  │
│  │  │   Serial: 00000002                      │                  │  │
│  │  │   Product: RTL2838UHIDIR                │                  │  │
│  │  └─────────────────────────────────────────┘                  │  │
│  │                                                               │  │
│  │  (If only one device is found, it is auto-selected            │  │
│  │   and the user sees a confirmation instead of a choice.)      │  │
│  │                                                               │  │
│  │                                          [ Next → ]           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  Step 2: SCANNING                                                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Scanning DAB+ Band III channels on Device 0...               │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────┐                  │  │
│  │  │  ████████████░░░░░░░░░░  12/38          │                  │  │
│  │  │  Currently scanning: Channel 8A         │                  │  │
│  │  │  Found so far: 2 transponders, 14 svc   │                  │  │
│  │  └─────────────────────────────────────────┘                  │  │
│  │                                                               │  │
│  │  Discovered transponders (live updates):                      │  │
│  │  ┌─────────────────────────────────────────┐                  │  │
│  │  │ ✓ 5C — "Local DAB" (4 services)         │                  │  │
│  │  │ ✓ 12A — "BBC National DAB" (10 services)│                  │  │
│  │  └─────────────────────────────────────────┘                  │  │
│  │                                                               │  │
│  │  (Scan runs automatically after device selection.             │  │
│  │   Progress updates via polling.)                              │  │
│  │                                                               │  │
│  │                          [ ← Back ]  (waits for scan to end)  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼ (scan complete)                      │
│  Step 3: TRANSPONDER SELECTION                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Scan complete! Found 3 transponders on Device 0.             │  │
│  │                                                               │  │
│  │  Select a transponder to use:                                 │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │ ○ 5C — "Local DAB" (223.936 MHz)                        │  │  │
│  │  │   ├─ Radio Station A        128 kbps  DAB+              │  │  │
│  │  │   ├─ Radio Station B         96 kbps  DAB+              │  │  │
│  │  │   ├─ Radio Station C         64 kbps  DAB+              │  │  │
│  │  │   └─ Radio Station D        128 kbps  DAB+              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │ ● 12A — "BBC National DAB" (223.936 MHz)                │  │  │
│  │  │   ├─ BBC Radio 1            128 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Radio 2            128 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Radio 3            192 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Radio 4             80 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Radio 5 Live        80 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Radio 6 Music      128 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Asian Network       48 kbps  DAB+              │  │  │
│  │  │   ├─ BBC World Service       48 kbps  DAB+              │  │  │
│  │  │   ├─ BBC Radio 4 Extra       48 kbps  DAB+              │  │  │
│  │  │   └─ BBC Radio 1Xtra         48 kbps  DAB+              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │ ○ 12D — "Digital One" (229.072 MHz)                     │  │  │
│  │  │   ├─ Classic FM             128 kbps  DAB+              │  │  │
│  │  │   ├─ Absolute Radio         128 kbps  DAB+              │  │  │
│  │  │   ├─ talkSPORT               48 kbps  DAB+              │  │  │
│  │  │   └─ LBC                     48 kbps  DAB+              │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  (If only one transponder is found, it is auto-selected       │  │
│  │   and the user sees a confirmation.)                          │  │
│  │                                                               │  │
│  │                          [ ← Back ]  [ Save & Listen → ]     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│  TRANSITION TO RADIO MODE                                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  API saves setup.json with:                                   │  │
│  │    - selected device index                                    │  │
│  │    - selected transponder/channel                             │  │
│  │    - completed = true                                         │  │
│  │                                                               │  │
│  │  API tunes welle-cli to the selected device + channel.        │  │
│  │                                                               │  │
│  │  Frontend transitions to the main radio UI.                   │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Wizard Step Details

**Step 1 — Device Selection:**
- The frontend calls `GET /api/devices` to list all detected RTL-SDR dongles.
- Each device is shown as a selectable card with index, product name, and serial.
- If only one device is connected, it is pre-selected and the card shows a "Only device detected — selected automatically" note. The user can still click Next to confirm.
- If zero devices are found, an error screen is shown: "No RTL-SDR devices detected. Please connect a dongle and refresh."
- Clicking **Next** saves the device choice to the wizard's in-memory state and proceeds to Step 2.

**Step 2 — Scanning:**
- The frontend calls `POST /api/scan/:deviceIndex` to begin scanning on the selected device.
- The scan runs asynchronously. The API returns immediately with `{ "status": "scanning", "scan_id": "..." }`.
- The frontend polls `GET /api/scan/:deviceIndex/progress` to get:
  ```json
  {
    "status": "scanning",
    "channels_scanned": 12,
    "channels_total": 38,
    "current_channel": "8A",
    "transponders_found": 2,
    "services_found": 14
  }
  ```
- As transponders are discovered, they appear in a live-updating list below the progress bar (summary only: ensemble name + service count).
- **Back** button: returns to Step 1. If scan is in progress, it is cancelled first (`POST /api/scan/:deviceIndex/cancel`).
- Once the scan completes (`status: "complete"`), the frontend automatically transitions to Step 3.

**Step 3 — Transponder Selection:**
- The frontend calls `GET /api/channels/:deviceIndex` to get full scan results.
- Each transponder is shown as an expandable card with:
  - Channel ID (e.g., "12A") and frequency.
  - Ensemble name and ID.
  - Full list of services with name, bitrate, and codec.
- The user selects one transponder via radio button.
- If only one transponder was found, it is pre-selected with a confirmation note.
- If zero transponders were found, a message is shown: "No DAB+ signals found. Check your antenna connection and try rescanning." with a **Rescan** button that goes back to Step 2.
- Clicking **Save & Listen** calls `POST /api/setup/complete` and transitions to the radio UI.

### Wizard Reset (from Radio Mode)

The main radio UI includes a **"Restart Setup"** button (in a settings area or header). Clicking it:
1. Calls `POST /api/setup/reset`.
2. The API sets `setup.completed = false` in `setup.json`, stops any active welle-cli streaming, releases device locks.
3. The frontend reloads into wizard mode.

---

## Application State Machine

```
                    ┌──────────────┐
      first start   │              │  POST /api/setup/reset
    ┌──────────────>│  WIZARD MODE │<────────────────────────┐
    │               │              │                          │
    │               └──────┬───────┘                          │
    │                      │                                  │
    │                      │ POST /api/setup/complete         │
    │                      │                                  │
    │               ┌──────▼───────┐                          │
    │               │              │                          │
    │               │  RADIO MODE  │──────────────────────────┘
    │               │              │  "Restart Setup" button
    │               └──────────────┘
    │
    │  On page load:
    │  GET /api/setup/status
    │  └─ { completed: false } ──> wizard
    │  └─ { completed: true }  ──> radio
```

The frontend checks `GET /api/setup/status` on every page load. This single endpoint determines which UI mode to render. No URL routing or hash-based navigation needed — the wizard and radio UI are both rendered by `app.js` based on setup state.

---

## Data Model

### setup.json (setup state — new)

```json
{
  "schema_version": 1,
  "completed": true,
  "completed_at": "2026-02-07T12:10:00Z",
  "selected_device": {
    "index": 0,
    "serial": "00000001"
  },
  "selected_transponder": {
    "channel": "12A",
    "ensemble_label": "BBC National DAB",
    "ensemble_id": "0xCE15"
  }
}
```

- `completed` is the gate for wizard vs. radio mode.
- `selected_device` records which dongle the user chose. Uses both `index` and `serial` so the system can detect if device indices shifted after a reboot (match by serial, warn if index changed).
- `selected_transponder` records which channel/ensemble the user chose. On radio mode entry, welle-cli is tuned to this channel on this device.

### devices.json (device registry — unchanged)

```json
{
  "schema_version": 1,
  "last_probe": "2026-02-07T12:00:00Z",
  "devices": [
    {
      "index": 0,
      "name": "Generic RTL2832U",
      "serial": "00000001",
      "product": "RTL2838UHIDIR",
      "manufacturer": "Realtek",
      "label": ""
    }
  ]
}
```

### channels.json (scan results, per-device — unchanged)

```json
{
  "schema_version": 2,
  "scans": [
    {
      "device_index": 0,
      "device_serial": "00000001",
      "scanned_at": "2026-02-07T12:00:00Z",
      "transponders": [
        {
          "channel": "12A",
          "frequency_mhz": 223.936,
          "ensemble": {
            "label": "BBC National DAB",
            "id": "0xCE15"
          },
          "services": [
            {
              "sid": "0xC221",
              "name": "BBC Radio 1",
              "bitrate": 128,
              "codec": "DAB+",
              "language": "",
              "programme_type": ""
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Multi-Device Management

### Core Concept

Each RTL-SDR dongle is identified by its **device index** (0, 1, 2, ...) as reported by `rtl_test` or librtlsdr. The system maintains a **device registry** (`devices.json`) and a **lock directory** (`/data/locks/`) to ensure exclusive access.

### Device Lifecycle

```
  ┌──────────┐     ┌───────────┐     ┌──────────┐     ┌──────────┐
  │ Detected │────>│ Available │────>│  Locked  │────>│ Available│
  │ (probe)  │     │ (idle)    │     │ (in use) │     │ (release)│
  └──────────┘     └───────────┘     └──────────┘     └──────────┘
                         │                 │
                         │    ┌────────────┘
                         │    │ used by:
                         │    ├─ scanning
                         │    └─ streaming
                         │
                    ┌────┴─────┐
                    │  Offline │  (dongle unplugged)
                    └──────────┘
```

### Device Locking Mechanism

Lock files in `/data/locks/` provide exclusive access. Each lock file is named `device-<index>.lock` and contains:

```json
{
  "device_index": 0,
  "locked_by": "streaming",
  "locked_at": "2026-02-07T12:00:00Z",
  "pid": 1234,
  "details": {
    "channel": "12A",
    "port": 7979
  }
}
```

**Lock rules:**
1. Before using a device, the API **must** acquire its lock by atomically creating the lock file.
2. If the lock file exists, the device is in use — the requesting operation must fail with a clear error.
3. When an operation finishes (or crashes), the lock is released (file deleted).
4. The API's `device-manager.js` is the single authority for lock acquisition/release.
5. A stale-lock reaper runs periodically to clean up locks whose processes are gone.

### Why the API Manages Locks

Containers can crash and be restarted. The API is the lock authority: it acquires locks before starting operations, releases them when done, and reaps stale locks on a timer.

---

## Docker Compose Services

### Service Dependency Graph

```
dab-server  ──(depends_on)──> (none, starts immediately)
api         ──(depends_on)──> dab-server (service_healthy)
web-ui      ──(depends_on)──> api (service_healthy)
```

### 1. `dab-core` (build-only base image)

- **Purpose**: Compile welle-cli once, share the binary.
- **Not a runtime service** — Docker build stage only.
- **Build**: Multi-stage Dockerfile. Stage 1 (`builder`): Ubuntu 24.04, build deps, compile welle-cli with `-DRTLSDR=1 -DBUILD_WELLE_IO=off`. Stage 2 (`runtime`): slim image, copy binary + runtime libs. Includes `rtl_test`.
- **Output**: `/usr/local/bin/welle-cli` and `/usr/local/bin/rtl_test`.

### 2. `dab-server` (welle-cli runtime)

- **Purpose**: DAB+ reception, MP3 streaming, device enumeration, channel scanning.
- **Image**: `FROM dab-core` runtime stage + `curl`, `jq`.
- **Entrypoint**: Starts a lightweight HTTP helper that exposes device enumeration and scan endpoints. Manages welle-cli process lifecycle — starts/stops welle-cli on demand from API calls.
- **welle-cli device selection**: `-D <device_index>` flag.
- **Internal HTTP API**:
  - `GET /mp3/<SID>` — MP3 audio stream (welle-cli native).
  - `GET /mux.json` — Current ensemble metadata (welle-cli native).
  - `POST /channel` — Switch DAB channel (welle-cli native).
  - `GET /devices` — List connected RTL-SDR devices (custom helper, runs `rtl_test`).
  - `POST /scan` — Scan all Band III channels on a device (custom helper).
  - `GET /scan/progress` — Scan progress (custom helper).
  - `POST /scan/cancel` — Cancel running scan (custom helper).
- **Health check**: `curl -sf http://localhost:${WELLE_PORT}/devices`.
- **Device access**: `/dev/bus/usb:/dev/bus/usb`.
- **Restart policy**: `unless-stopped`.

### 3. `api` (Node.js backend)

- **Purpose**: REST API gateway. Manages setup state, devices, locks, scan results, and proxies audio streams.
- **Image**: `node:20-alpine`.
- **Internal structure**:

```
api/src/
├── index.js                  # Express app setup, middleware, mount routers
├── config.js                 # Env var loading & validation
├── routes/
│   ├── setup.js              # Setup wizard state & actions
│   ├── devices.js            # Device listing, labeling, status
│   ├── channels.js           # Scan results per device
│   ├── tuner.js              # Tune device to channel, stream proxy
│   ├── scanner.js            # Trigger/monitor/cancel scan on a device
│   └── health.js             # Health check & system status
└── services/
    ├── setup-store.js        # Read/write setup.json (wizard state)
    ├── device-manager.js     # Device registry, lock acquisition/release, stale lock reaper
    ├── dab-backend.js        # welle-cli HTTP abstraction (device-aware)
    ├── channel-store.js      # Read/write channels.json (per-device scan data)
    └── scanner.js            # Scan orchestration with device locking
```

**New module: `services/setup-store.js`**
- Reads/writes `setup.json`.
- Exports:
  ```javascript
  getSetupStatus()                          // -> { completed, selected_device, selected_transponder }
  isSetupComplete()                         // -> boolean
  saveSetup(deviceIndex, transponder)       // -> void (sets completed=true, writes config)
  resetSetup()                              // -> void (sets completed=false, clears selections)
  ```

**New route: `routes/setup.js`**

| Method | Path                     | Description                                    | Response                                |
|--------|--------------------------|------------------------------------------------|-----------------------------------------|
| GET    | `/api/setup/status`      | Get current setup state                        | `{ completed, selected_device, selected_transponder }` |
| POST   | `/api/setup/complete`    | Finalize wizard, save selections, start streaming | `{ success: true }`                   |
| POST   | `/api/setup/reset`       | Reset setup, stop streaming, release locks     | `{ success: true }`                   |

**Updated route: `routes/scanner.js`**

| Method | Path                           | Description                         | Response                               |
|--------|--------------------------------|-------------------------------------|----------------------------------------|
| POST   | `/api/scan/:deviceIndex`       | Start scanning a device             | `{ status: "scanning", scan_id: "..." }` |
| GET    | `/api/scan/:deviceIndex/progress` | Get scan progress                | `{ status, channels_scanned, channels_total, current_channel, transponders_found, services_found }` |
| POST   | `/api/scan/:deviceIndex/cancel`| Cancel a running scan               | `{ status: "cancelled" }`             |

**Other API endpoints (unchanged from previous plan):**

| Method | Path                        | Description                                    | Response                              |
|--------|-----------------------------|------------------------------------------------|---------------------------------------|
| GET    | `/api/devices`              | List all detected RTL-SDR devices with status  | `{ devices: [...] }`                 |
| POST   | `/api/devices/probe`        | Re-detect connected RTL-SDR devices            | `{ devices: [...] }`                 |
| PATCH  | `/api/devices/:index`       | Update device label                            | `{ device: { index, label, ... } }`  |
| GET    | `/api/devices/:index/status`| Detailed status of one device                  | `{ device, lock, currentChannel }`   |
| GET    | `/api/channels`             | All scan results (all devices)                 | `{ scans: [...] }`                   |
| GET    | `/api/channels/:deviceIndex`| Scan results for a specific device             | `{ transponders: [...] }`            |
| POST   | `/api/tune`                 | Tune a device to a channel for streaming       | `{ device: 0, channel: "12A" }`      |
| GET    | `/api/current`              | Currently active stream info                   | `{ device, channel, services }`      |
| GET    | `/api/status`               | System health check                            | `{ healthy, devices, activeStreams }` |

**`POST /api/setup/complete` behavior:**
1. Validate that the referenced device exists and the transponder was found in scan data.
2. Save `setup.json` with `completed: true`, selected device, and selected transponder.
3. Acquire device lock for `"streaming"`.
4. Start welle-cli on the selected device + channel.
5. Return success.

**`POST /api/setup/reset` behavior:**
1. Stop any running welle-cli streaming.
2. Release all device locks.
3. Set `setup.completed = false` in `setup.json`.
4. Optionally clear scan data (configurable — default: keep scan data so rescan is optional).
5. Return success.

**Stream proxying (unchanged)**: nginx routes `/stream/*` to the API, which proxies to the correct welle-cli instance based on the active device lock.

- **Health check**: `curl -sf http://localhost:${API_PORT}/api/status`.
- **Restart policy**: `unless-stopped`.

### 4. `web-ui` (nginx + static frontend)

- **Purpose**: Serve static frontend files and reverse-proxy API/stream requests.
- **Image**: `nginx:alpine`.
- **nginx.conf** (parameterized via envsubst):
  - `location /` -> static files
  - `location /api/` -> `proxy_pass http://api:${API_PORT}/api/`
  - `location /stream/` -> `proxy_pass http://api:${API_PORT}/api/stream/`
  - Stream location: `proxy_buffering off`, `chunked_transfer_encoding on`, long timeouts.
- **Port**: `${WEB_PORT}` (default 8080) exposed to host.
- **Restart policy**: `unless-stopped`.

---

## Web Frontend Design

### Module Structure

```
web/public/
├── index.html            # Page shell, minimal — just a mount point
├── css/
│   ├── variables.css     # CSS custom properties (theme tokens)
│   ├── layout.css        # Grid/flexbox layout (radio mode)
│   ├── wizard.css        # Wizard-specific styles (steps, progress, cards)
│   └── components.css    # Shared component styles (buttons, cards, badges)
└── js/
    ├── app.js            # Entry point — checks setup status, renders wizard or radio
    ├── api.js            # HTTP client for /api/* endpoints
    ├── wizard.js         # Wizard controller — manages step flow, state, transitions
    ├── devices.js        # Device selector UI (used by wizard step 1 + radio mode)
    ├── player.js         # Audio playback controller (HTML5 <audio>)
    ├── channels.js       # Channel/station list rendering & selection
    ├── nowplaying.js     # Now-playing display panel
    └── scanner.js        # Scan progress UI (used by wizard step 2 + radio rescan)
```

**New module: `wizard.js`**
- Manages the three-step wizard flow.
- Maintains wizard state: `{ currentStep, selectedDevice, scanResults, selectedTransponder }`.
- Renders the appropriate step UI and handles Next/Back/Save navigation.
- Reuses `devices.js` for device selection rendering and `scanner.js` for scan progress display.
- On "Save & Listen", calls `POST /api/setup/complete` and triggers `app.js` to switch to radio mode.

**Updated module: `app.js`**
- On load, calls `GET /api/setup/status`.
- If `completed === false` (or 404): renders wizard via `wizard.js`.
- If `completed === true`: renders radio UI (channels, player, now-playing).
- Exposes a `restartSetup()` function that calls `POST /api/setup/reset` and re-renders into wizard mode.

**Updated module: `api.js`** — adds wizard-related methods:
```javascript
getSetupStatus()                              // GET /api/setup/status
completeSetup(deviceIndex, transponder)       // POST /api/setup/complete
resetSetup()                                  // POST /api/setup/reset
startScan(deviceIndex)                        // POST /api/scan/:deviceIndex
getScanProgress(deviceIndex)                  // GET /api/scan/:deviceIndex/progress
cancelScan(deviceIndex)                       // POST /api/scan/:deviceIndex/cancel
```

### Radio Mode UI Layout (post-wizard)

```
┌───────────────────────────────────────────────────────┐
│  DAB+ Radio Streamer                    [⚙ Setup]     │
├──────────────────┬────────────────────────────────────┤
│  Transponders    │  Now Playing                       │
│  ┌────────────┐  │                                    │
│  │ ▸ 5C       │  │  Station: BBC Radio 1              │
│  │   12A  ◄── │  │  Ensemble: National DAB            │
│  │   12D      │  │  Device: Device 0 (00000001)       │
│  └────────────┘  │  Bitrate: 128 kbps | Codec: DAB+  │
│                  │                                    │
│  Stations (12A)  │  ┌──────────────────────────────┐  │
│  ┌────────────┐  │  │                              │  │
│  │ ● Radio 1  │  │  │  ⏵ ──────────────────○──   │  │
│  │ ○ Radio 2  │  │  └──────────────────────────────┘  │
│  │ ○ Radio 3  │  │                                    │
│  │ ○ Radio 4  │  │  Volume: ──────────○──             │
│  └────────────┘  │                                    │
├──────────────────┴────────────────────────────────────┤
│  Device 0 | Channel 12A | 10 services                 │
└───────────────────────────────────────────────────────┘
```

- The **[Setup]** button in the header triggers `restartSetup()` — resets setup and re-enters the wizard.
- The device cards from the previous plan are removed from the main radio UI — device selection is handled exclusively by the wizard. The status bar shows the active device.
- Users who want to change devices click **[Setup]** and go through the wizard again.

---

## File Structure

```
dab-streamer/
├── docker-compose.yml
├── .env                              # Configuration variables
├── .env.example                      # Documented example config
├── .gitignore                        # Ignore data/, node_modules, etc.
│
├── base/                             # Shared base image (dab-core)
│   └── Dockerfile                    # Multi-stage: build welle-cli + rtl_test
│
├── server/                           # DAB+ server (welle-cli + helpers)
│   ├── Dockerfile                    # FROM dab-core runtime stage + curl, jq
│   ├── entrypoint.sh                 # Start helper API, manage welle-cli lifecycle
│   ├── scan.sh                       # Scan all Band III channels on a device
│   └── detect-devices.sh            # Enumerate RTL-SDR devices as JSON
│
├── api/                              # REST API backend
│   ├── Dockerfile                    # FROM node:20-alpine
│   ├── package.json
│   └── src/
│       ├── index.js                  # Express app setup
│       ├── config.js                 # Env var loading & validation
│       ├── routes/
│       │   ├── setup.js              # Wizard state & actions
│       │   ├── devices.js            # Device listing, labeling, status
│       │   ├── channels.js           # Scan results endpoints
│       │   ├── tuner.js              # Tuning & stream proxy endpoints
│       │   ├── scanner.js            # Scan trigger/progress/cancel
│       │   └── health.js             # Health check endpoint
│       └── services/
│           ├── setup-store.js        # setup.json persistence
│           ├── device-manager.js     # Device registry, locking, stale reaper
│           ├── dab-backend.js        # welle-cli HTTP abstraction (device-aware)
│           ├── channel-store.js      # channels.json persistence (per-device)
│           └── scanner.js            # Scan orchestration
│
├── web/                              # Web frontend + reverse proxy
│   ├── Dockerfile                    # FROM nginx:alpine
│   ├── nginx.conf.template           # Parameterized nginx config
│   └── public/
│       ├── index.html
│       ├── css/
│       │   ├── variables.css         # Theme tokens
│       │   ├── layout.css            # Radio mode layout
│       │   ├── wizard.css            # Wizard steps, progress bar, cards
│       │   └── components.css        # Shared components
│       └── js/
│           ├── app.js                # Entry point — wizard/radio mode switch
│           ├── api.js                # Backend HTTP client
│           ├── wizard.js             # Wizard step controller
│           ├── devices.js            # Device selector UI
│           ├── player.js             # Audio playback controller
│           ├── channels.js           # Channel list UI
│           ├── nowplaying.js         # Now-playing panel
│           └── scanner.js            # Scan progress UI
│
└── data/                             # Docker volume mount (gitignored)
    ├── setup.json                    # Wizard/setup state (created at runtime)
    ├── devices.json                  # Device registry (created at runtime)
    ├── channels.json                 # Scan results (created at runtime)
    └── locks/                        # Device lock files (runtime)
```

---

## Implementation Steps

### Phase 1: Base Image & Infrastructure
1. Create project directory structure and `.gitignore`.
2. Write `base/Dockerfile` — multi-stage build for welle-cli + rtl_test.
3. Write `docker-compose.yml` with all services, volumes, networks, health checks, dependency graph.
4. Write `.env` and `.env.example`.

### Phase 2: DAB Server (welle-cli + helpers)
5. Write `server/Dockerfile` — extends dab-core, adds curl + jq.
6. Write `server/detect-devices.sh` — runs `rtl_test`, parses output, returns JSON.
7. Write `server/scan.sh` — accepts `device_index` arg, iterates all 38 Band III channels, writes progress to a temp file for polling, returns JSON scan result.
8. Write `server/entrypoint.sh` — HTTP helper exposing `/devices`, `/scan`, `/scan/progress`, `/scan/cancel`.

### Phase 3: API Backend — Services
9. Write `api/Dockerfile` and `api/package.json`.
10. Write `api/src/config.js` — env var loading, defaults.
11. Write `api/src/services/setup-store.js` — setup.json CRUD.
12. Write `api/src/services/device-manager.js` — device registry, lock management, stale reaper.
13. Write `api/src/services/channel-store.js` — per-device scan persistence.
14. Write `api/src/services/dab-backend.js` — device-aware welle-cli HTTP abstraction.
15. Write `api/src/services/scanner.js` — scan orchestration with locking and progress.

### Phase 4: API Backend — Routes
16. Write `api/src/routes/setup.js` — GET status, POST complete, POST reset.
17. Write `api/src/routes/devices.js` — device listing, probe, label, status.
18. Write `api/src/routes/channels.js` — per-device and all-device scan results.
19. Write `api/src/routes/tuner.js` — tune with device selection, stream proxy.
20. Write `api/src/routes/scanner.js` — scan trigger, progress, cancel.
21. Write `api/src/routes/health.js` — system health.
22. Write `api/src/index.js` — Express app assembly, error middleware, stale lock reaper interval.

### Phase 5: Web Frontend — Wizard
23. Write `web/nginx.conf.template` — reverse proxy config.
24. Write `web/Dockerfile`.
25. Write `web/public/css/variables.css` — theme tokens.
26. Write `web/public/css/wizard.css` — step indicators, progress bar, selection cards, transition animations.
27. Write `web/public/css/components.css` — buttons, cards, badges, radio inputs.
28. Write `web/public/js/api.js` — HTTP client including setup + scan methods.
29. Write `web/public/js/wizard.js` — three-step wizard controller with state management.
30. Write `web/public/js/devices.js` — device selection cards (shared between wizard and radio mode).
31. Write `web/public/js/scanner.js` — scan progress bar and live transponder discovery list.

### Phase 6: Web Frontend — Radio Mode
32. Write `web/public/css/layout.css` — radio mode grid layout.
33. Write `web/public/js/player.js` — HTML5 audio controller.
34. Write `web/public/js/channels.js` — transponder/station list with selection.
35. Write `web/public/js/nowplaying.js` — now-playing panel with device info.
36. Write `web/public/js/app.js` — entry point, setup check, mode switching, restart setup handler.
37. Write `web/public/index.html` — page shell.

### Phase 7: Integration & Error Handling
38. Error handling: no devices found, device unplugged mid-scan, scan finds nothing, device locked conflict.
39. Wizard edge cases: back-button during scan (cancel first), zero results, single-item auto-selection.
40. Setup reset: stop streaming, release locks, clear setup state, reload to wizard.
41. Startup recovery: if `setup.completed === true` on page load, auto-tune to saved device + channel.

---

## Configuration (.env)

```env
# === Ports (internal, not exposed to host except WEB_PORT) ===
WEB_PORT=8080
WELLE_PORT=7979
API_PORT=3000

# === DAB Tuning ===
# Fallback channel if no scan data exists
DEFAULT_CHANNEL=5A

# === Scanner ===
# Seconds to wait per channel during scan
SCAN_TIMEOUT=10

# === Device Management ===
# Seconds between stale lock reaper runs
LOCK_REAPER_INTERVAL=30

# === Setup ===
# Whether to keep scan data on setup reset (true/false)
KEEP_SCAN_DATA_ON_RESET=true

# === Networking ===
NETWORK_NAME=dab-net
```

---

## Key Technical Details

### RTL-SDR USB Passthrough

```yaml
services:
  dab-server:
    devices:
      - /dev/bus/usb:/dev/bus/usb
```

**Host prerequisite**: Blacklist the `dvb_usb_rtl28xxu` kernel module:
```bash
echo "blacklist dvb_usb_rtl28xxu" | sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf
sudo modprobe -r dvb_usb_rtl28xxu
```

### welle-cli Device Selection

```bash
welle-cli -D 0 -c 12A -w 7979    # Use device 0
welle-cli -D 1 -c 5C  -w 7980    # Use device 1
```

### Scan Progress Mechanism

The scan script (`scan.sh`) writes progress to a JSON file (`/tmp/scan-progress.json`) as it iterates channels. The dab-server HTTP helper reads this file to serve the `/scan/progress` endpoint. The API polls this endpoint and passes it to the frontend.

```
scan.sh ──writes──> /tmp/scan-progress.json
                           │
dab-server helper ──reads──┘──serves──> GET /scan/progress
                                              │
api ──polls──────────────────────────────────┘──serves──> GET /api/scan/:idx/progress
                                                               │
frontend ──polls──────────────────────────────────────────────┘
```

### Stream Proxy Flow

```
Browser                 nginx              API               welle-cli
  │                      │                  │                    │
  │  GET /stream/0xC221  │                  │                    │
  │ ────────────────────>│                  │                    │
  │                      │  /api/stream/    │                    │
  │                      │ ────────────────>│                    │
  │                      │                  │  lookup active     │
  │                      │                  │  device & port     │
  │                      │                  │  from lock file    │
  │                      │                  │                    │
  │                      │                  │  GET /mp3/0xC221   │
  │                      │                  │ ──────────────────>│
  │                      │                  │                    │
  │              chunked audio stream piped back                 │
  │ <════════════════════════════════════════════════════════════│
```

### Startup Recovery

When the system restarts and `setup.completed === true`:
1. API reads `setup.json` on startup.
2. Probes devices to verify the selected device is still connected (match by serial).
3. If found: acquires lock, starts welle-cli on the saved device + channel.
4. If not found (dongle unplugged): marks setup as needing attention. Frontend shows a warning with option to restart setup.

---

## Modularity Design

### Principles

1. **Single Responsibility** — Server streams. API orchestrates. Nginx routes. Frontend renders.
2. **Shared Base Image** — `dab-core` multi-stage build used by `dab-server`.
3. **Contract-Based Communication** — HTTP APIs, shared volume with defined JSON schemas, environment variables.
4. **Backend Abstraction** — `dab-backend.js` is the swap point for decoder technology.
5. **Device Abstraction** — `device-manager.js` encapsulates all device discovery, locking, and lifecycle.
6. **Setup Abstraction** — `setup-store.js` encapsulates wizard state. The frontend and routes never touch `setup.json` directly.
7. **Frontend Decoupling** — The web UI knows only `/api/*` and `/stream/*`. Wizard and radio mode are both driven by API state.
8. **Module Reuse** — `devices.js` and `scanner.js` frontend modules are used by both the wizard and the radio mode (rescan from settings).

### Replaceability Matrix

| Component      | Swappable With                          | Interface Contract                                 |
|----------------|-----------------------------------------|----------------------------------------------------|
| dab-server     | dab-cmdline + ffmpeg + Icecast          | HTTP audio at `/stream/<SID>`, `/devices`, `/scan` |
| api            | Any REST server (Python, Go, etc.)      | JSON REST at `/api/*` (see API spec)               |
| web-ui         | React/Vue SPA, mobile app, etc.         | Consumes `/api/*` and `/stream/*`                  |
| nginx          | Traefik, Caddy, HAProxy                 | Reverse proxy with same route rules                |
| persistence    | SQLite, Redis, PostgreSQL               | Read/write via service modules                     |
| device locking | Redis locks, database locks, flock      | Acquire/release via `device-manager` interface     |
| setup state    | Database row, Redis key, etc.           | Read/write via `setup-store` interface             |

---

## Dependencies & Prerequisites

- **Host**: Linux with USB support (RTL-SDR passthrough requires Linux host kernel).
- **RTL-SDR dongle(s)**: One or more RTL2832U-based dongles. For multi-device, each dongle should have a unique serial number (set with `rtl_eeprom -s <serial>`).
- **Kernel module blacklist**: `dvb_usb_rtl28xxu` must be blacklisted on the host.
- **Docker Engine** >= 24.0 and **Docker Compose** v2.
- **DAB+ coverage**: Antenna location(s) must have DAB+ signal.
