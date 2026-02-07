# SoapySDR Migration Plan

## Overview

Migrate dab-streamer from the current RTL-SDR + `rtl_tcp` intermediary architecture to SoapySDR, a universal SDR abstraction layer. This eliminates the `rtl_tcp` process entirely, simplifies device lifecycle management, and enables support for multiple SDR hardware types (RTL-SDR, Airspy, LimeSDR, HackRF, etc.) through a single unified interface.

## Why SoapySDR?

| Current (rtl_tcp) | After (SoapySDR) |
|---|---|
| Two processes per stream: `rtl_tcp` + `welle-cli` | Single process: `welle-cli` only |
| `rtl_tcp` hangs on SIGTERM (pthread_join bug), needs SIGKILL fallback | No intermediary process to hang |
| Only supports RTL-SDR dongles | Supports RTL-SDR, Airspy, LimeSDR, HackRF, USRP, and more |
| Device selection via `rtl_tcp -d <index>` port hack | Native device addressing via `driver=rtlsdr,serial=XXXX` |
| Custom `rtl_test` output parsing for detection | Standard `SoapySDRUtil --find` enumeration |

## welle-cli SoapySDR Support

welle-cli already supports SoapySDR when compiled with `-DSOAPYSDR=1`. The relevant flags:

```bash
# Select SoapySDR as input driver
welle-cli -F soapysdr

# Specify device via -s flag (NOT via -F comma argument)
welle-cli -F soapysdr -s "driver=rtlsdr,serial=00000001" -c 10B -w 7979

# Antenna selection (optional, for devices like LimeSDR)
welle-cli -F soapysdr -s "driver=lime" -A "LNAW" -c 10B -w 7979

# If -s is omitted, opens the first available SoapySDR device
welle-cli -F soapysdr -c 10B -w 7979
```

## SoapySDR Device Addressing

Devices are addressed with comma-separated `key=value` strings:

| Device Type | Address String |
|---|---|
| RTL-SDR (by serial) | `driver=rtlsdr,serial=00000001` |
| RTL-SDR (by index) | `driver=rtlsdr,rtl=0` |
| Airspy | `driver=airspy` |
| LimeSDR | `driver=lime` |
| HackRF | `driver=hackrf` |

Serial-based addressing is preferred for multi-device setups since indices can shift across reboots.

## Ubuntu 24.04 Packages

**Required:**
| Package | Purpose |
|---|---|
| `libsoapysdr-dev` | Build dependency (already installed) |
| `libsoapysdr0.8` | Runtime library (already installed) |
| `soapysdr-tools` | Provides `SoapySDRUtil` for device enumeration |
| `soapysdr-module-rtlsdr` | RTL-SDR hardware support via SoapySDR |

**Optional (for additional hardware):**
| Package | Purpose |
|---|---|
| `soapysdr-module-airspy` | Airspy support |
| `soapysdr-module-hackrf` | HackRF support |
| `soapysdr-module-lms7` | LimeSDR support |
| `soapysdr-module-uhd` | Ettus USRP support |
| `soapysdr-module-remote` | SoapyRemote network device support |

**Note:** The Dockerfile already installs `libsoapysdr-dev` and `libsoapysdr0.8` but does NOT install `soapysdr-tools` or any `soapysdr-module-*` packages.

## Impact Analysis

| File | Change Level | Summary |
|---|---|---|
| `server/Dockerfile` | Medium | Add SoapySDR packages, change CMake flag, keep `rtl-sdr` package for backward compat or remove |
| `server/server.py` | **Heavy** | Remove entire `rtl_tcp` lifecycle, simplify `start_welle()` to single process |
| `server/detect-devices.sh` | **Complete rewrite** | Replace `rtl_test` parsing with `SoapySDRUtil --find` parsing |
| `server/scan.sh` | **Heavy** | Remove `rtl_tcp` launch/cleanup, change welle-cli `-F` flag |
| `server/entrypoint.sh` | None | No changes needed |
| `api/src/services/dab-backend.js` | Minimal | Update comments, possibly pass device string instead of index |
| `api/src/services/device-manager.js` | Minimal | Update comments, add `driver` field to device data model |
| `api/src/routes/tuner.js` | Low | Pass `device_driver` alongside `device_index` if needed |
| Frontend JS files | Minimal | Show device type in device cards |
| `docker-compose.yml` | Low | Remove `RTL_TCP_BASE_PORT` env var |
| `.env.example` | Low | Remove `RTL_TCP_BASE_PORT`, optionally add `SOAPYSDR_MODULES` |

---

## Implementation Phases

### Phase 1: Dockerfile — Build welle-cli with SoapySDR

**File: `server/Dockerfile`**

Changes:
1. Add `soapysdr-tools` and `soapysdr-module-rtlsdr` to runtime packages
2. Optionally add `soapysdr-module-airspy` (or make it configurable via build arg)
3. Change CMake flags from `-DRTLSDR=1` to `-DSOAPYSDR=1`
4. Keep `-DRTLSDR=1` as well for now (belt and suspenders — welle-cli can have both compiled in)
5. Keep the `rtl-sdr` package (still useful for `rtl_eeprom` serial programming)

```dockerfile
# Runtime packages — add SoapySDR tools and modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    libfaad2 libmpg123-0 libfftw3-single3 libusb-1.0-0 \
    libsoapysdr0.8 libmp3lame0 \
    rtl-sdr \
    soapysdr-tools \
    soapysdr-module-rtlsdr \
    curl jq bc procps python3

# Build with both RTL-SDR and SoapySDR support
cmake .. \
    -DRTLSDR=1 \
    -DSOAPYSDR=1 \
    -DBUILD_WELLE_IO=OFF \
    -DCMAKE_INSTALL_PREFIX=/usr/local
```

**Verification:** After build, run `welle-cli --help` inside the container and confirm `soapysdr` appears as a valid `-F` option.

### Phase 2: Device Detection — Replace `rtl_test` with `SoapySDRUtil`

**File: `server/detect-devices.sh`** — Complete rewrite

`SoapySDRUtil --find` output format:
```
Found device 0
  available = Yes
  driver = rtlsdr
  label = Generic RTL2832U OEM :: 00000001
  manufacturer = Realtek
  product = RTL2838UHIDIR
  rtl = 0
  serial = 00000001
  tuner = Rafael Micro R820T
```

The new script should:
1. Run `SoapySDRUtil --find` with a timeout
2. Parse the structured key-value output
3. Output a JSON array matching the current format, with an added `driver` field:

```json
[
  {
    "index": 0,
    "name": "Generic RTL2832U OEM :: 00000001",
    "serial": "00000001",
    "product": "RTL2838UHIDIR",
    "manufacturer": "Realtek",
    "driver": "rtlsdr"
  },
  {
    "index": 1,
    "name": "Airspy Mini",
    "serial": "A64F2C8037121234",
    "product": "Airspy Mini",
    "manufacturer": "Airspy",
    "driver": "airspy"
  }
]
```

The `driver` field is critical — it tells the rest of the stack which SoapySDR driver string to use when starting welle-cli.

**Parsing approach:** Use `awk` or a simple Python script to parse the `SoapySDRUtil` output. Python is already available in the container and would be cleaner for this structured-but-not-JSON format.

### Phase 3: Server — Eliminate `rtl_tcp` Intermediary

**File: `server/server.py`** — Heavy changes

#### 3a. Remove `rtl_tcp` process management

Delete:
- `RTL_TCP_BASE_PORT` constant and env var
- `rtl_tcp_process` global variable
- `start_rtl_tcp(device_index)` function
- `stop_rtl_tcp_internal()` function
- All `rtl_tcp` references in `stop_welle_internal()`
- `rtl_tcp_base_port` from settings endpoint response

#### 3b. Update `start_welle()` to use SoapySDR

Current (two-process):
```python
def start_welle(device_index, channel, port, gain=-1):
    rtl_tcp_process, rtl_port = start_rtl_tcp(device_index)
    time.sleep(2)
    cmd = ["welle-cli", "-F", f"rtl_tcp,127.0.0.1:{rtl_port}", "-c", channel, "-w", str(port)]
```

New (single-process):
```python
def start_welle(device_index, channel, port, gain=-1, device_driver=None, device_serial=None):
    # Build SoapySDR device string
    if device_serial and device_driver:
        soapy_args = f"driver={device_driver},serial={device_serial}"
    elif device_driver:
        soapy_args = f"driver={device_driver}"
    else:
        soapy_args = ""  # Use first available device

    cmd = ["welle-cli", "-F", "soapysdr", "-c", channel, "-w", str(port)]
    if soapy_args:
        cmd.extend(["-s", soapy_args])
    if gain >= 0:
        cmd.extend(["-g", str(gain)])
```

#### 3c. Simplify `stop_welle_internal()`

Current: kills welle-cli, then kills rtl_tcp (with SIGKILL fallback for rtl_tcp hang).
New: just kills welle-cli. No second process to manage.

#### 3d. Update `/start` endpoint

The `/start` POST body currently accepts `device_index`. Extend to accept `device_driver` and `device_serial`:

```json
{
  "device_index": 0,
  "channel": "10B",
  "gain": -1,
  "device_driver": "rtlsdr",
  "device_serial": "00000001"
}
```

#### 3e. Update `/devices` endpoint

The `detect_devices()` function delegates to the rewritten `detect-devices.sh`. No changes needed here since it just returns whatever the script outputs.

### Phase 4: Scanner — Remove `rtl_tcp` from Scan Flow

**File: `server/scan.sh`** — Heavy changes

#### 4a. Remove `rtl_tcp` launch and cleanup

Delete:
- `RTL_TCP_BASE_PORT` variable and port calculation
- `RTL_TCP_PID` variable
- `rtl_tcp` launch block (the `rtl_tcp -d "$DEVICE_INDEX" -p "$RTL_TCP_PORT" &` section)
- `rtl_tcp` kill in `cleanup()` function

#### 4b. Change welle-cli launch command

Current:
```bash
WELLE_CMD=("welle-cli" "-F" "rtl_tcp,127.0.0.1:${RTL_TCP_PORT}" "-c" "$channel" "-w" "$WELLE_PORT")
```

New:
```bash
# Accept device driver and serial as script arguments
DEVICE_DRIVER="${4:-}"
DEVICE_SERIAL="${5:-}"

WELLE_CMD=("welle-cli" "-F" "soapysdr" "-c" "$channel" "-w" "$WELLE_PORT")
if [ -n "$DEVICE_SERIAL" ] && [ -n "$DEVICE_DRIVER" ]; then
    WELLE_CMD+=("-s" "driver=${DEVICE_DRIVER},serial=${DEVICE_SERIAL}")
elif [ -n "$DEVICE_DRIVER" ]; then
    WELLE_CMD+=("-s" "driver=${DEVICE_DRIVER}")
fi
```

#### 4c. Simplify cleanup

Current: kills welle-cli first (dies instantly, no signal handler), then kills rtl_tcp (can hang, needs SIGKILL).
New: just kills welle-cli. No second process.

#### 4d. Update scan invocation in `server.py`

The `start_scan()` function in `server.py` calls `scan.sh` with positional args. Add `device_driver` and `device_serial` as new arguments.

### Phase 5: API Layer — Pass Device Info Through

**File: `api/src/services/dab-backend.js`**

Update `startStreaming()` to pass `device_driver` and `device_serial` alongside `device_index`:

```javascript
async startStreaming(deviceIndex, channel, gain, deviceDriver, deviceSerial) {
    const body = {
        device_index: deviceIndex,
        channel,
        gain: gain !== undefined ? gain : -1,
        device_driver: deviceDriver,
        device_serial: deviceSerial,
    };
    // POST to dab-server /start
}
```

**File: `api/src/services/device-manager.js`**

The device data model already includes `serial`. Add `driver` to the stored device objects. The `probeDevices()` function already saves whatever comes from the detect endpoint — it just needs to preserve the new `driver` field.

**File: `api/src/routes/tuner.js`**

Update the `POST /api/tune` and `POST /api/tune-discover` endpoints to look up the selected device's `driver` and `serial` from the device manager and pass them through to `dab-backend.startStreaming()`.

### Phase 6: Frontend — Show Device Type

**File: `web/public/js/devices.js`**

Update device card rendering to show the device driver type (e.g., "RTL-SDR", "Airspy") as a badge or subtitle on each device card.

**File: `web/public/js/wizard.js`**

No functional changes needed — the wizard already works with device objects from the API. The device cards will just show more info.

### Phase 7: Configuration Cleanup

**File: `docker-compose.yml`**
- Remove `RTL_TCP_BASE_PORT` from `dab-server` environment (if present)
- Remove it from `api` environment (if present)

**File: `.env.example`**
- Remove `RTL_TCP_BASE_PORT` if present
- Optionally add a comment about supported SoapySDR hardware

**File: `README.md`**
- Update prerequisites to mention SoapySDR-compatible devices
- Update architecture diagram (remove rtl_tcp reference)
- Add section listing supported hardware
- Update troubleshooting for SoapySDR-specific issues

---

## Device Data Model (Before & After)

**Before:**
```json
{
  "index": 0,
  "name": "Generic RTL2832U OEM",
  "serial": "00000001",
  "product": "RTL2838UHIDIR",
  "manufacturer": "Realtek"
}
```

**After:**
```json
{
  "index": 0,
  "name": "Generic RTL2832U OEM :: 00000001",
  "serial": "00000001",
  "product": "RTL2838UHIDIR",
  "manufacturer": "Realtek",
  "driver": "rtlsdr"
}
```

The `driver` field is the key addition. It flows through:
`detect-devices.sh` → `server.py /devices` → `device-manager.js` → `devices.json` → API routes → `dab-backend.js` → `server.py /start` → `welle-cli -s "driver=...,serial=..."`

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| SoapySDR module not finding RTL-SDR device | Low | Keep `rtl-sdr` package installed; `soapysdr-module-rtlsdr` depends on `librtlsdr` |
| welle-cli SoapySDR gain handling differs from direct RTL-SDR | Medium | Test gain values; SoapySDR normalises gain to 0-1 range but welle-cli may handle internally |
| `SoapySDRUtil --find` output format changes between versions | Low | Pin `libsoapysdr0.8` in Dockerfile; version is stable in Ubuntu 24.04 |
| Airspy/LimeSDR devices need different antenna settings | Medium | Add optional antenna config in settings; pass `-A` flag to welle-cli |
| Kernel driver conflicts (DVB driver for RTL-SDR, default drivers for others) | Medium | Document blacklisting requirements per device type |
| Container USB permissions for non-RTL-SDR devices | Low | Already using `privileged: true` and `/dev/bus/usb` passthrough |

---

## Testing Checklist

- [ ] welle-cli builds with `-DSOAPYSDR=1` in the Docker image
- [ ] `SoapySDRUtil --find` detects RTL-SDR dongle inside the container
- [ ] `detect-devices.sh` outputs correct JSON with `driver` field
- [ ] Streaming works via `welle-cli -F soapysdr -s "driver=rtlsdr,serial=..."`
- [ ] Scanning all 38 channels works without `rtl_tcp`
- [ ] Manual channel selection (tune-discover) works
- [ ] Device locking still works correctly
- [ ] Stop/cleanup kills welle-cli cleanly (no orphan processes)
- [ ] Gain settings are applied correctly via SoapySDR
- [ ] Multiple RTL-SDR dongles are detected and selectable
- [ ] Frontend shows device type on device cards
- [ ] (If available) Test with an Airspy device

---

## Estimated Effort

| Phase | Effort |
|---|---|
| Phase 1: Dockerfile | Small (30 min) |
| Phase 2: detect-devices.sh rewrite | Medium (1-2 hours) |
| Phase 3: server.py refactor | Large (2-3 hours) |
| Phase 4: scan.sh refactor | Medium (1-2 hours) |
| Phase 5: API layer updates | Small (1 hour) |
| Phase 6: Frontend updates | Small (30 min) |
| Phase 7: Config/docs cleanup | Small (30 min) |
| **Total** | **~7-10 hours** |

---

## Order of Implementation

1. **Phase 1** (Dockerfile) — Must be first; everything else depends on SoapySDR being compiled in
2. **Phase 2** (detect-devices.sh) — Can be tested independently once the container builds
3. **Phase 3** (server.py) — Core change; depends on Phase 1
4. **Phase 4** (scan.sh) — Depends on Phase 3 patterns
5. **Phase 5** (API layer) — Depends on Phase 3 API contract
6. **Phase 6** (Frontend) — Can be done in parallel with Phases 3-5
7. **Phase 7** (Cleanup) — Last, after everything is tested
