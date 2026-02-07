#!/bin/bash
# Detect connected RTL-SDR devices and output a JSON array.
#
# rtl_test prints device info to stderr then starts a blocking test.
# We use 'timeout' to kill it after capturing the device listing.
#
# Output format:
#   Found 1 device(s):
#     0:  Realtek, RTL2838UHIDIR, SN: 00000001

set -uo pipefail

# Run rtl_test with a short timeout — it prints the device list immediately
# then blocks on the actual test. 2 seconds is plenty to capture the listing.
RTL_OUTPUT=$(timeout 2 rtl_test 2>&1 || true)

# Check if any devices were found
FOUND_LINE=$(echo "$RTL_OUTPUT" | grep -i "Found.*device" || echo "")
if [ -z "$FOUND_LINE" ]; then
    echo "[]"
    exit 0
fi

DEVICE_COUNT=$(echo "$FOUND_LINE" | grep -oP '[0-9]+(?=\s+device)' || echo "0")
if [ "$DEVICE_COUNT" -eq 0 ] 2>/dev/null; then
    echo "[]"
    exit 0
fi

# Parse device lines: "  0:  Realtek, RTL2838UHIDIR, SN: 00000001"
RESULT="["
FIRST=true

while IFS= read -r line; do
    # Match lines like "  0:  Realtek, RTL2838UHIDIR, SN: 00000001"
    if echo "$line" | grep -qP '^\s*\d+:'; then
        DEVINDEX=$(echo "$line" | grep -oP '^\s*\K\d+(?=:)')
        INFO=$(echo "$line" | sed -E 's/^\s*[0-9]+:\s*//')
        MANUFACTURER=$(echo "$INFO" | cut -d',' -f1 | xargs)
        PRODUCT=$(echo "$INFO" | cut -d',' -f2 | xargs)

        SERIAL="unknown"
        if echo "$INFO" | grep -qP 'SN:\s*\S+'; then
            SERIAL=$(echo "$INFO" | grep -oP 'SN:\s*\K\S+')
        fi

        if [ "$FIRST" = true ]; then
            FIRST=false
        else
            RESULT+=","
        fi

        RESULT+=$(jq -nc \
            --argjson index "${DEVINDEX:-0}" \
            --arg name "$MANUFACTURER $PRODUCT" \
            --arg serial "$SERIAL" \
            --arg product "$PRODUCT" \
            --arg manufacturer "$MANUFACTURER" \
            '{index: $index, name: $name, serial: $serial, product: $product, manufacturer: $manufacturer}')
    fi
done <<< "$RTL_OUTPUT"

RESULT+="]"

echo "$RESULT"
