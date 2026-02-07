# dab-streamer

A Dockerized web application for receiving and streaming DAB+ digital radio using RTL-SDR dongles. Browse and listen to DAB+ radio stations directly in your web browser.

## Features

- **DAB+ reception** via RTL-SDR USB dongles using [welle-cli](https://github.com/AlbrechtL/welle.io)
- **Multi-device support** — manage multiple RTL-SDR dongles with exclusive locking to prevent conflicts
- **Setup wizard** — guided first-run experience: select a device, scan for channels, pick a transponder
- **Web-based streaming** — listen to DAB+ stations in any modern browser via HTML5 audio
- **Channel scanning** — automatic scan of all 38 DAB Band III channels (5A through 13F) with live progress
- **Modular architecture** — four Docker containers with clear separation of concerns
- **Dark theme UI** — clean, modern interface designed for radio listening

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Docker Compose Stack                     │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  dab-server   │  │     api      │  │   web-ui     │       │
│  │  (welle-cli)  │  │  (Node.js)   │  │   (nginx)    │       │
│  │  Port 8888    │  │  Port 3000   │  │   Port 80    │──┐    │
│  │  (management) │  │              │  │              │  │    │
│  │  Port 7979    │  │  Express     │  │  Static      │  │    │
│  │  (audio)      │  │  REST API    │  │  + Proxy     │  │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │    │
│         │                  │                             │    │
│         └──────────────────┘                             │    │
│              dab-net (internal)                          │    │
│                                                          │    │
│  volume: dab-data                                        │    │
│    setup.json | devices.json | channels.json | locks/    │    │
└──────────────────────────────────────────────────────────┘    │
       │                                                        │
  /dev/bus/usb                                    Host port 8080┘
  (RTL-SDR)
```

### Components

| Service | Role | Technology |
|---------|------|------------|
| **dab-server** | DAB+ reception, audio streaming, device enumeration, channel scanning | welle-cli + Python management API |
| **api** | REST API gateway, setup state, device locking, stream proxying | Node.js / Express |
| **web-ui** | Static frontend serving and reverse proxy | nginx |

### Data Flow

1. **Device detection**: API asks dab-server to enumerate RTL-SDR dongles via `rtl_test`
2. **Scanning**: API instructs dab-server to scan DAB channels using welle-cli on a specific device
3. **Streaming**: API starts welle-cli on a device+channel; welle-cli provides MP3 streams at `/mp3/<SID>`
4. **Playback**: Browser requests `/stream/<SID>` → nginx → API → welle-cli → MP3 audio chunks

## Prerequisites

### Hardware

- **RTL-SDR dongle** — any RTL2832U-based USB dongle (e.g., RTL-SDR Blog V3, Nooelec NESDR)
- **DAB+ antenna** — connected to the RTL-SDR dongle, positioned for DAB+ signal reception
- For **multiple dongles**, each should have a unique serial number (set with `rtl_eeprom -s <serial>`)

### Software

- **Linux host** — USB device passthrough to Docker requires a Linux kernel
- **Docker Engine** >= 24.0
- **Docker Compose** v2

### Host Configuration

The Linux kernel's DVB driver must be blacklisted to prevent it from claiming the RTL-SDR device before librtlsdr:

```bash
# Blacklist the kernel DVB driver
echo "blacklist dvb_usb_rtl28xxu" | sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf
sudo modprobe -r dvb_usb_rtl28xxu
```

Verify your dongle is detected:

```bash
# Install rtl-sdr tools on the host (for testing)
sudo apt install rtl-sdr

# List connected devices
rtl_test -t
```

## Installation

### 1. Clone the repository

```bash
git clone <repository-url> dab-streamer
cd dab-streamer
```

### 2. Configure environment

```bash
# Copy the example config
cp .env.example .env

# Edit if needed (defaults work for most setups)
# nano .env
```

Available configuration options:

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_PORT` | `8080` | Web UI port exposed on the host |
| `WELLE_PORT` | `7979` | welle-cli internal streaming port |
| `API_PORT` | `3000` | API backend internal port |
| `DEFAULT_CHANNEL` | `5A` | Fallback DAB channel |
| `SCAN_TIMEOUT` | `10` | Seconds to wait per channel during scan |
| `LOCK_REAPER_INTERVAL` | `30` | Seconds between stale lock cleanup |
| `KEEP_SCAN_DATA_ON_RESET` | `true` | Preserve scan data when restarting setup wizard |

### 3. Build and start

```bash
docker compose up -d --build
```

The first build compiles welle-cli from source, which may take several minutes depending on your hardware.

### 4. Open the web UI

Navigate to `http://<host-ip>:8080` in your browser.

On first launch, you will be greeted by the setup wizard.

## Usage

### Setup Wizard

The setup wizard runs automatically on first launch (or when setup is reset).

**Step 1 — Select Device**

All connected RTL-SDR dongles are detected and listed. Select the device you want to use for DAB+ reception. If only one device is connected, it is automatically selected.

**Step 2 — Scan Channels**

The system scans all 38 DAB Band III channels (5A through 13F) on your selected device. This takes approximately 6-7 minutes. A progress bar shows the current channel being scanned, and discovered transponders appear in real-time as they are found.

**Step 3 — Select Transponder**

All discovered transponders (DAB ensembles) are listed with their full service lineup — station name, bitrate, and codec for each service. Select the transponder containing the stations you want to listen to.

Click **Save & Listen** to complete setup and enter the radio UI.

### Radio UI

After setup, the main radio interface provides:

- **Station list** — all services on the selected transponder, click to start listening
- **Now Playing** — current station name, ensemble, bitrate, and codec information
- **Audio player** — play/pause control and volume slider
- **Status bar** — active device and channel information

### Restarting Setup

Click the **Setup** button in the header to restart the setup wizard. This stops any active streaming, releases device locks, and returns to the device selection step. Previous scan data is preserved by default.

## Multi-Device Support

The system supports multiple RTL-SDR dongles connected simultaneously.

### Device Locking

Only one operation can use a device at a time. The API manages exclusive locks:

- **Scanning** locks the device for the duration of the scan
- **Streaming** locks the device while audio is being received
- Attempting to use a locked device returns a clear error
- Stale locks from crashed processes are automatically cleaned up

### Device Identification

Devices are identified by both their index (assigned by the OS) and serial number. Serial numbers persist across reboots, while indices may change. The system matches by serial to detect when a previously configured dongle has shifted to a different index.

To set a unique serial on your dongle:

```bash
rtl_eeprom -d 0 -s 00000001
rtl_eeprom -d 1 -s 00000002
```

## Project Structure

```
dab-streamer/
├── docker-compose.yml          # Service orchestration
├── .env                        # Configuration
├── .env.example                # Documented config template
├── .gitignore
├── README.md
├── PLAN.md                     # Detailed architecture plan
│
├── base/                       # Shared base image (build reference)
│   └── Dockerfile
│
├── server/                     # DAB+ server container
│   ├── Dockerfile              # Ubuntu 24.04 + welle-cli from source
│   ├── entrypoint.sh           # Starts Python management API
│   ├── server.py               # HTTP management API (device/scan/stream control)
│   ├── detect-devices.sh       # RTL-SDR device enumeration script
│   └── scan.sh                 # Band III channel scanner script
│
├── api/                        # REST API backend container
│   ├── Dockerfile              # Node.js 20 Alpine
│   ├── package.json
│   └── src/
│       ├── index.js            # Express app setup and startup
│       ├── config.js           # Environment configuration
│       ├── routes/
│       │   ├── setup.js        # Setup wizard state endpoints
│       │   ├── devices.js      # Device management endpoints
│       │   ├── channels.js     # Scan results endpoints
│       │   ├── tuner.js        # Tuning and stream proxy endpoints
│       │   ├── scanner.js      # Scan control endpoints
│       │   └── health.js       # Health check endpoint
│       └── services/
│           ├── setup-store.js  # Wizard state persistence
│           ├── device-manager.js # Device registry and locking
│           ├── dab-backend.js  # welle-cli HTTP abstraction
│           ├── channel-store.js # Scan results persistence
│           └── scanner.js      # Scan orchestration
│
├── web/                        # Web frontend container
│   ├── Dockerfile              # nginx Alpine
│   ├── nginx.conf.template     # Reverse proxy config (envsubst)
│   └── public/
│       ├── index.html          # Single page shell
│       ├── css/
│       │   ├── variables.css   # Theme tokens
│       │   ├── components.css  # Shared component styles
│       │   ├── wizard.css      # Setup wizard styles
│       │   └── layout.css      # Radio mode layout
│       └── js/
│           ├── app.js          # Entry point and mode switching
│           ├── api.js          # Backend HTTP client
│           ├── wizard.js       # Setup wizard controller
│           ├── devices.js      # Device card rendering
│           ├── player.js       # HTML5 audio controller
│           ├── channels.js     # Station list UI
│           ├── nowplaying.js   # Now-playing display
│           └── scanner.js      # Scan progress UI
│
└── data/                       # Runtime data (Docker volume, gitignored)
    ├── setup.json              # Wizard state
    ├── devices.json            # Device registry
    ├── channels.json           # Scan results
    └── locks/                  # Device lock files
```

## API Reference

### Setup

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/setup/status` | Current setup state (completed, selected device, transponder) |
| `POST` | `/api/setup/complete` | Finalize wizard and start streaming |
| `POST` | `/api/setup/reset` | Reset setup, stop streaming, return to wizard |

### Devices

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/devices` | List all detected RTL-SDR devices with lock status |
| `POST` | `/api/devices/probe` | Re-detect connected devices |
| `PATCH` | `/api/devices/:index` | Update device label |
| `GET` | `/api/devices/:index/status` | Detailed device status |

### Scanner

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scan/:deviceIndex` | Start scanning on a device |
| `GET` | `/api/scan/:deviceIndex/progress` | Get scan progress |
| `POST` | `/api/scan/:deviceIndex/cancel` | Cancel running scan |

### Channels

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/channels` | All scan results (all devices) |
| `GET` | `/api/channels/:deviceIndex` | Scan results for a specific device |

### Tuner

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tune` | Tune a device to a channel |
| `GET` | `/api/current` | Currently active stream info |
| `GET` | `/api/stream/:sid` | Audio stream proxy (MP3) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | System health check |

## Persistence

All runtime state is stored as JSON files on the `dab-data` Docker volume, mounted at `/data` inside containers:

| File | Purpose | Created By |
|------|---------|------------|
| `setup.json` | Wizard completion state, selected device and transponder | API |
| `devices.json` | Detected RTL-SDR device registry with labels | API |
| `channels.json` | Per-device scan results (transponders and services) | API |
| `locks/device-N.lock` | Exclusive device lock files | API |

Data persists across container restarts. To fully reset the application, remove the Docker volume:

```bash
docker compose down -v
```

## DAB Band III Channels

The scanner iterates all 38 standard channels:

```
5A  5B  5C  5D
6A  6B  6C  6D
7A  7B  7C  7D
8A  8B  8C  8D
9A  9B  9C  9D
10A 10B 10C 10D
11A 11B 11C 11D
12A 12B 12C 12D
13A 13B 13C 13D 13E 13F
```

Each channel corresponds to a center frequency in the 174-240 MHz range. A transponder (DAB ensemble) occupies one channel and carries multiple radio services (stations).

## Troubleshooting

### No RTL-SDR devices detected

- Verify the dongle is plugged in: `lsusb | grep RTL`
- Check the kernel driver is blacklisted: `lsmod | grep dvb` (should show nothing)
- Restart Docker after blacklisting: `sudo systemctl restart docker`
- Verify device access: `rtl_test -t` on the host

### Scan finds no transponders

- Check antenna connection to the RTL-SDR dongle
- Verify your area has DAB+ coverage — check your national DAB coverage map
- Try positioning the antenna near a window or higher location
- Increase `SCAN_TIMEOUT` in `.env` (default 10 seconds per channel)

### Audio stream not playing

- Check browser console for errors
- Verify the stream URL is accessible: `curl http://localhost:8080/stream/<SID>`
- Check that welle-cli is running: `docker compose logs dab-server`
- Try a different browser — some mobile browsers restrict background audio

### Container build fails

- welle-cli compilation requires several GB of RAM — ensure Docker has sufficient memory
- On resource-constrained systems, the build may take 10+ minutes
- Check Docker build logs: `docker compose build --no-cache dab-server`

### Device locked error

- A previous scan or stream may not have released its lock
- The stale lock reaper runs every 30 seconds by default
- Force unlock by restarting the API: `docker compose restart api`
- Or reset via the UI: click the Setup button to restart the wizard

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| DAB+ decoder | [welle-cli](https://github.com/AlbrechtL/welle.io) | Latest (built from source) |
| Server OS | Ubuntu | 24.04 |
| API runtime | Node.js | 20 (Alpine) |
| API framework | Express | 4.x |
| Web server | nginx | Alpine |
| Frontend | Vanilla HTML5/CSS3/JS | ES Modules |
| Containerization | Docker Compose | v2 |
| SDR library | librtlsdr | System package |

## License

This project uses the following open-source components:
- [welle.io](https://github.com/AlbrechtL/welle.io) — GPL-2.0
- [librtlsdr](https://github.com/steve-m/librtlsdr) — GPL-2.0
