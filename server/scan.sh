#!/bin/bash
# Scan all DAB Band III channels on a specific RTL-SDR device.
# Usage: scan.sh <device_index> [scan_timeout]
#
# Device selection: welle-cli has no device index flag, so we use rtl_tcp
# as an intermediary. rtl_tcp -d <index> selects the specific dongle,
# and welle-cli connects via -F rtl_tcp,127.0.0.1:<port>.
#
# Writes progress to /tmp/scan-progress.json
# Writes final results to stdout as JSON

set -euo pipefail

DEVICE_INDEX="${1:?Usage: scan.sh <device_index> [scan_timeout]}"
SCAN_TIMEOUT="${2:-${SCAN_TIMEOUT:-10}}"
WELLE_PORT="${WELLE_PORT:-7979}"
RTL_TCP_BASE_PORT="${RTL_TCP_BASE_PORT:-1234}"
GAIN="${GAIN:--1}"
SCAN_PORT=$((WELLE_PORT + 100 + DEVICE_INDEX))
RTL_TCP_PORT=$((RTL_TCP_BASE_PORT + 100 + DEVICE_INDEX))

PROGRESS_FILE="/tmp/scan-progress.json"
RESULT_FILE="/tmp/scan-result.json"
CANCEL_FILE="/tmp/scan-cancel"

# All DAB Band III channels
CHANNELS=(
    5A 5B 5C 5D
    6A 6B 6C 6D
    7A 7B 7C 7D
    8A 8B 8C 8D
    9A 9B 9C 9D
    10A 10B 10C 10D
    11A 11B 11C 11D
    12A 12B 12C 12D
    13A 13B 13C 13D 13E 13F
)

TOTAL=${#CHANNELS[@]}

# Track PIDs for cleanup
RTL_TCP_PID=""
WELLE_PID=""

# Kill a process with SIGTERM, wait up to N seconds, then SIGKILL.
# Usage: kill_with_timeout <pid> [timeout_seconds]
kill_with_timeout() {
    local pid=$1
    local timeout=${2:-5}

    kill "$pid" 2>/dev/null || return 0

    local i=0
    while [ "$i" -lt "$timeout" ]; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 1
        i=$((i + 1))
    done

    # Still alive — force kill
    echo "[scan] Process $pid did not exit after ${timeout}s, sending SIGKILL" >&2
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
}

# Clean up on exit
cleanup() {
    # Kill welle-cli first (dies instantly, no signal handler)
    if [ -n "${WELLE_PID:-}" ] && kill -0 "$WELLE_PID" 2>/dev/null; then
        kill_with_timeout "$WELLE_PID" 3
    fi
    # Then kill rtl_tcp (may need SIGKILL due to known hangs)
    if [ -n "${RTL_TCP_PID:-}" ] && kill -0 "$RTL_TCP_PID" 2>/dev/null; then
        kill_with_timeout "$RTL_TCP_PID" 5
    fi
    rm -f "$CANCEL_FILE"
}
trap cleanup EXIT

# Remove stale cancel file
rm -f "$CANCEL_FILE"

# Initialize progress
jq -nc \
    --arg status "scanning" \
    --argjson scanned 0 \
    --argjson total "$TOTAL" \
    --arg current "${CHANNELS[0]}" \
    --argjson transponders_found 0 \
    --argjson services_found 0 \
    '{status: $status, channels_scanned: $scanned, channels_total: $total, current_channel: $current, transponders_found: $transponders_found, services_found: $services_found, transponders: []}' \
    > "$PROGRESS_FILE"

# Step 1: Start rtl_tcp for device selection
echo "[scan] Starting rtl_tcp -d $DEVICE_INDEX -p $RTL_TCP_PORT" >&2
rtl_tcp -d "$DEVICE_INDEX" -p "$RTL_TCP_PORT" &
RTL_TCP_PID=$!

# Give rtl_tcp time to bind its port
sleep 2

# Check that rtl_tcp is still running
if ! kill -0 "$RTL_TCP_PID" 2>/dev/null; then
    echo "[scan] ERROR: rtl_tcp exited immediately — device $DEVICE_INDEX may not exist" >&2
    echo "[]"
    exit 1
fi

# Step 2: Build welle-cli command with rtl_tcp backend
WELLE_CMD=("welle-cli" "-F" "rtl_tcp,127.0.0.1:${RTL_TCP_PORT}" "-c" "${CHANNELS[0]}" "-w" "$SCAN_PORT")

# Add gain if not AGC (-1)
if [ "$GAIN" != "-1" ]; then
    WELLE_CMD+=("-g" "$GAIN")
fi

echo "[scan] Starting welle-cli: ${WELLE_CMD[*]}" >&2
"${WELLE_CMD[@]}" &
WELLE_PID=$!

# Wait for welle-cli to start
sleep 3

TRANSPONDERS="[]"
TRANSPONDERS_FOUND=0
SERVICES_FOUND=0
SCANNED=0

for CHANNEL in "${CHANNELS[@]}"; do
    # Check for cancel
    if [ -f "$CANCEL_FILE" ]; then
        jq -nc \
            --arg status "cancelled" \
            --argjson scanned "$SCANNED" \
            --argjson total "$TOTAL" \
            --arg current "$CHANNEL" \
            --argjson transponders_found "$TRANSPONDERS_FOUND" \
            --argjson services_found "$SERVICES_FOUND" \
            '{status: $status, channels_scanned: $scanned, channels_total: $total, current_channel: $current, transponders_found: $transponders_found, services_found: $services_found}' \
            > "$PROGRESS_FILE"
        echo "$TRANSPONDERS"
        exit 0
    fi

    # Switch to this channel
    curl -sf -X POST -d "$CHANNEL" "http://localhost:$SCAN_PORT/channel" >/dev/null 2>&1 || true

    # Update progress
    jq -nc \
        --arg status "scanning" \
        --argjson scanned "$SCANNED" \
        --argjson total "$TOTAL" \
        --arg current "$CHANNEL" \
        --argjson transponders_found "$TRANSPONDERS_FOUND" \
        --argjson services_found "$SERVICES_FOUND" \
        --argjson transponders "$TRANSPONDERS" \
        '{status: $status, channels_scanned: $scanned, channels_total: $total, current_channel: $current, transponders_found: $transponders_found, services_found: $services_found, transponders: $transponders}' \
        > "$PROGRESS_FILE"

    # Wait for sync and check for services
    WAIT=0
    FOUND=false
    while [ "$WAIT" -lt "$SCAN_TIMEOUT" ]; do
        sleep 1
        WAIT=$((WAIT + 1))

        # Check for cancel during wait
        if [ -f "$CANCEL_FILE" ]; then
            break 2
        fi

        MUX=$(curl -sf "http://localhost:$SCAN_PORT/mux.json" 2>/dev/null || echo "{}")
        SERVICE_COUNT=$(echo "$MUX" | jq '.services | length' 2>/dev/null || echo "0")

        if [ "$SERVICE_COUNT" -gt 0 ]; then
            FOUND=true
            break
        fi
    done

    SCANNED=$((SCANNED + 1))

    if [ "$FOUND" = true ]; then
        # Extract ensemble info
        # welle-cli nests labels: .ensemble.label is an object {label, shortlabel, ...}
        # The actual name string is at .ensemble.label.label
        ENSEMBLE_LABEL=$(echo "$MUX" | jq -r '.ensemble.label.label // .ensemble.label // "Unknown"' 2>/dev/null || echo "Unknown")
        ENSEMBLE_ID=$(echo "$MUX" | jq -r '.ensemble.id // "0x0000"' 2>/dev/null || echo "0x0000")

        # Build services array — filter to audio-only services
        # welle-cli service structure:
        #   .label is {label, shortlabel, ...} — name at .label.label
        #   .components[0].subchannel.bitrate — bitrate
        #   .components[0].ascty — codec string ("DAB+" or "DAB")
        #   .components[0].transportmode — "audio" for audio services, "streamdata"/"packetdata" for data (SPI, EPG, TPEG)
        SERVICES=$(echo "$MUX" | jq '[.services[] | select(.components[0].transportmode == "audio") | {
            sid: .sid,
            name: (.label.label // .label // "Unknown"),
            bitrate: ((.components[0].subchannel.bitrate // 0) | tonumber),
            codec: (.components[0].ascty // "DAB"),
            language: (.languagestring // ""),
            programme_type: (.ptystring // ""),
            transportmode: (.components[0].transportmode // "audio")
        }]' 2>/dev/null || echo "[]")

        SVC_COUNT=$(echo "$SERVICES" | jq 'length' 2>/dev/null || echo "0")
        SERVICES_FOUND=$((SERVICES_FOUND + SVC_COUNT))

        # Get frequency for this channel from welle-cli
        FREQ=$(echo "$MUX" | jq '.demodulator.frequencycorrection // 0' 2>/dev/null || echo "0")
        # Use channel name as primary identifier; frequency from demodulator is a correction value
        # Build transponder with just channel name
        TRANSPONDER=$(jq -nc \
            --arg channel "$CHANNEL" \
            --arg elabel "$ENSEMBLE_LABEL" \
            --arg eid "$ENSEMBLE_ID" \
            --argjson services "$SERVICES" \
            '{channel: $channel, ensemble: {label: $elabel, id: $eid}, services: $services}')

        TRANSPONDERS=$(echo "$TRANSPONDERS" | jq --argjson t "$TRANSPONDER" '. + [$t]')
        TRANSPONDERS_FOUND=$((TRANSPONDERS_FOUND + 1))
    fi

    # Update progress with latest state
    jq -nc \
        --arg status "scanning" \
        --argjson scanned "$SCANNED" \
        --argjson total "$TOTAL" \
        --arg current "$CHANNEL" \
        --argjson transponders_found "$TRANSPONDERS_FOUND" \
        --argjson services_found "$SERVICES_FOUND" \
        --argjson transponders "$TRANSPONDERS" \
        '{status: $status, channels_scanned: $scanned, channels_total: $total, current_channel: $current, transponders_found: $transponders_found, services_found: $services_found, transponders: $transponders}' \
        > "$PROGRESS_FILE"
done

# Kill welle-cli first (no signal handler, dies instantly on SIGTERM)
kill_with_timeout "$WELLE_PID" 3
unset WELLE_PID

# Then kill rtl_tcp (can hang on SIGTERM due to known pthread_join issues)
kill_with_timeout "$RTL_TCP_PID" 5
unset RTL_TCP_PID

# Write final progress
jq -nc \
    --arg status "complete" \
    --argjson scanned "$TOTAL" \
    --argjson total "$TOTAL" \
    --arg current "" \
    --argjson transponders_found "$TRANSPONDERS_FOUND" \
    --argjson services_found "$SERVICES_FOUND" \
    --argjson transponders "$TRANSPONDERS" \
    '{status: $status, channels_scanned: $scanned, channels_total: $total, current_channel: $current, transponders_found: $transponders_found, services_found: $services_found, transponders: $transponders}' \
    > "$PROGRESS_FILE"

# Output results to stdout
echo "$TRANSPONDERS"
