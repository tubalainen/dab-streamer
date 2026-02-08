#!/usr/bin/env python3
"""
dab-server management HTTP API.

Provides endpoints for device enumeration, welle-cli lifecycle management,
and channel scanning. This runs alongside welle-cli and proxies requests
to it when appropriate.

Device selection strategy:
  welle-cli has no built-in device index flag. We use rtl_tcp as an
  intermediary — rtl_tcp supports `-d <index>` to select a specific
  RTL-SDR dongle. welle-cli then connects via `-F rtl_tcp,127.0.0.1:<port>`.
"""

import http.server
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error

MGMT_PORT = int(os.environ.get("MGMT_PORT", "8888"))
WELLE_PORT = int(os.environ.get("WELLE_PORT", "7979"))
SCAN_TIMEOUT = int(os.environ.get("SCAN_TIMEOUT", "10"))

# Base port for rtl_tcp instances (each device gets base + device_index)
RTL_TCP_BASE_PORT = int(os.environ.get("RTL_TCP_BASE_PORT", "1234"))

welle_process = None
rtl_tcp_process = None
welle_lock = threading.Lock()
scan_process = None
scan_lock = threading.Lock()

# Current gain setting (-1 = AGC, 0-49 = manual gain in dB)
current_gain = int(os.environ.get("DEFAULT_GAIN", "-1"))

# Valid DAB Band III channels for input validation
VALID_DAB_CHANNELS = {
    '5A','5B','5C','5D','6A','6B','6C','6D',
    '7A','7B','7C','7D','8A','8B','8C','8D',
    '9A','9B','9C','9D','10A','10B','10C','10D','10N',
    '11A','11B','11C','11D','11N',
    '12A','12B','12C','12D','12N',
    '13A','13B','13C','13D','13E','13F',
}


def get_rtl_tcp_port(device_index):
    """Get the rtl_tcp port for a given device index."""
    return RTL_TCP_BASE_PORT + device_index


def start_rtl_tcp(device_index):
    """Start rtl_tcp for a specific RTL-SDR device index.

    Returns the subprocess and the port it's listening on.
    """
    port = get_rtl_tcp_port(device_index)
    cmd = ["rtl_tcp", "-d", str(device_index), "-p", str(port)]
    print(f"[server] Starting rtl_tcp: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Give rtl_tcp a moment to bind its port
    time.sleep(1)
    if proc.poll() is not None:
        raise RuntimeError(f"rtl_tcp exited immediately (device {device_index} may not exist)")
    return proc, port


def stop_rtl_tcp_internal():
    """Stop any running rtl_tcp process (must hold welle_lock)."""
    global rtl_tcp_process
    if rtl_tcp_process and rtl_tcp_process.poll() is None:
        rtl_tcp_process.terminate()
        try:
            rtl_tcp_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            rtl_tcp_process.kill()
            rtl_tcp_process.wait()
    rtl_tcp_process = None


def start_welle(device_index, channel, port=None, gain=None):
    """Start a welle-cli instance connected to a specific RTL-SDR device.

    Uses rtl_tcp as intermediary for device selection:
      1. Start rtl_tcp -d <device_index> -p <rtl_port>
      2. Start welle-cli -F rtl_tcp,127.0.0.1:<rtl_port> -c <channel> -w <port>
    """
    global welle_process, rtl_tcp_process
    if port is None:
        port = WELLE_PORT
    if gain is None:
        gain = current_gain

    with welle_lock:
        stop_welle_internal()

        # Step 1: Start rtl_tcp for device selection
        rtl_tcp_process, rtl_port = start_rtl_tcp(device_index)

        # Step 2: Start welle-cli connected to rtl_tcp
        cmd = [
            "welle-cli",
            "-F", f"rtl_tcp,127.0.0.1:{rtl_port}",
            "-c", channel,
            "-w", str(port),
        ]

        # Add gain if not AGC
        if gain is not None and gain != -1:
            cmd.extend(["-g", str(gain)])

        print(f"[server] Starting welle-cli: {' '.join(cmd)}")
        welle_process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Give welle-cli time to start and connect
        time.sleep(2)

        if welle_process.poll() is not None:
            stop_rtl_tcp_internal()
            raise RuntimeError("welle-cli exited immediately")

        return welle_process.pid


def stop_welle_internal():
    """Stop welle-cli and rtl_tcp (must hold welle_lock)."""
    global welle_process
    if welle_process and welle_process.poll() is None:
        welle_process.terminate()
        try:
            welle_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            welle_process.kill()
            welle_process.wait()
    welle_process = None

    # Also stop rtl_tcp
    stop_rtl_tcp_internal()


def stop_welle():
    """Stop welle-cli and rtl_tcp (public, acquires lock)."""
    with welle_lock:
        stop_welle_internal()


def is_welle_running():
    """Check if welle-cli is running."""
    return welle_process is not None and welle_process.poll() is None


def detect_devices():
    """Run detect-devices.sh and return parsed JSON."""
    try:
        result = subprocess.run(
            ["detect-devices.sh"],
            capture_output=True, text=True, timeout=10
        )
        return json.loads(result.stdout.strip() or "[]")
    except Exception as e:
        return []


def start_scan(device_index, gain=None):
    """Start a channel scan in the background."""
    global scan_process
    if gain is None:
        gain = current_gain

    with scan_lock:
        if scan_process and scan_process.poll() is None:
            return None  # scan already running
        # Clean up old progress
        try:
            os.remove("/tmp/scan-cancel")
        except FileNotFoundError:
            pass

        env = os.environ.copy()
        env["RTL_TCP_BASE_PORT"] = str(RTL_TCP_BASE_PORT)
        env["GAIN"] = str(gain)

        cmd = ["scan.sh", str(device_index), str(SCAN_TIMEOUT)]
        scan_process = subprocess.Popen(
            cmd,
            stdout=open("/tmp/scan-result.json", "w"),
            stderr=subprocess.DEVNULL,
            env=env
        )
        return scan_process.pid


def cancel_scan():
    """Cancel a running scan."""
    global scan_process
    with scan_lock:
        if scan_process and scan_process.poll() is None:
            # Signal the scan script to stop
            open("/tmp/scan-cancel", "w").close()
            try:
                scan_process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                scan_process.kill()
                scan_process.wait()
        scan_process = None


def get_scan_progress():
    """Read current scan progress."""
    try:
        with open("/tmp/scan-progress.json", "r") as f:
            progress = json.load(f)
        # Check if scan process has exited
        with scan_lock:
            if scan_process and scan_process.poll() is not None:
                progress["status"] = "complete"
        return progress
    except (FileNotFoundError, json.JSONDecodeError):
        return {"status": "idle"}


def proxy_to_welle(method, path, body=None):
    """Proxy a request to the running welle-cli instance."""
    if not is_welle_running():
        return None
    url = f"http://localhost:{WELLE_PORT}{path}"
    try:
        if method == "POST":
            data = body.encode("utf-8") if body else b""
            req = urllib.request.Request(url, data=data, method="POST")
        else:
            req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read()
    except Exception:
        return None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default logging to reduce noise
        pass

    def send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 0:
            return self.rfile.read(length).decode("utf-8")
        return ""

    def do_GET(self):
        if self.path == "/devices":
            devices = detect_devices()
            self.send_json(200, devices)

        elif self.path == "/scan/progress":
            progress = get_scan_progress()
            self.send_json(200, progress)

        elif self.path == "/health":
            self.send_json(200, {
                "status": "ok",
                "welle_running": is_welle_running()
            })

        elif self.path == "/settings":
            self.send_json(200, {
                "gain": current_gain,
                "rtl_tcp_base_port": RTL_TCP_BASE_PORT,
            })

        elif self.path.startswith("/slide/"):
            # Slideshow/MOT image proxy (station logos)
            if not is_welle_running():
                self.send_json(503, {"error": "welle-cli not running"})
                return
            try:
                url = f"http://localhost:{WELLE_PORT}{self.path}"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    content_type = resp.headers.get("Content-Type", "image/png")
                    data = resp.read()
                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    self.wfile.write(data)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.send_response(404)
                    self.end_headers()
                else:
                    self.send_json(502, {"error": "slide fetch error"})
            except Exception:
                self.send_json(502, {"error": "slide fetch error"})

        elif self.path.startswith("/mp3/"):
            # Stream proxy - special handling for audio
            if not is_welle_running():
                self.send_json(503, {"error": "welle-cli not running"})
                return
            try:
                url = f"http://localhost:{WELLE_PORT}{self.path}"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req) as resp:
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Transfer-Encoding", "chunked")
                    self.send_header("Connection", "close")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    while True:
                        chunk = resp.read(16384)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
            except Exception:
                self.send_json(502, {"error": "stream error"})

        else:
            # Proxy to welle-cli
            result = proxy_to_welle("GET", self.path)
            if result is not None:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(result)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(result)
            else:
                self.send_json(503, {"error": "welle-cli not running or no response"})

    def do_POST(self):
        global current_gain
        body = self.read_body()

        if self.path == "/start":
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self.send_json(400, {"error": "Invalid JSON body"})
                return
            device_index = data.get("device_index", 0)
            channel = data.get("channel", "5A")
            port = data.get("port", WELLE_PORT)
            gain = data.get("gain", current_gain)

            # Validate inputs
            if not isinstance(device_index, int) or device_index < 0 or device_index > 15:
                self.send_json(400, {"error": f"Invalid device_index: {device_index}"})
                return
            if channel not in VALID_DAB_CHANNELS:
                self.send_json(400, {"error": f"Invalid DAB channel: {channel}"})
                return
            if not isinstance(gain, (int, float)) or gain < -1 or gain > 49:
                self.send_json(400, {"error": f"Invalid gain value: {gain}"})
                return

            try:
                pid = start_welle(device_index, channel, port, gain)
            except RuntimeError as e:
                self.send_json(500, {"error": str(e)})
                return

            self.send_json(200, {
                "status": "started",
                "device_index": device_index,
                "channel": channel,
                "port": port,
                "gain": gain,
                "pid": pid
            })

        elif self.path == "/stop":
            stop_welle()
            self.send_json(200, {"status": "stopped"})

        elif self.path == "/scan":
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self.send_json(400, {"error": "Invalid JSON body"})
                return
            device_index = data.get("device_index", 0)
            gain = data.get("gain", current_gain)

            # Validate device_index
            if not isinstance(device_index, int) or device_index < 0 or device_index > 15:
                self.send_json(400, {"error": f"Invalid device_index: {device_index}"})
                return

            pid = start_scan(device_index, gain)
            if pid is None:
                self.send_json(409, {"error": "scan already in progress"})
            else:
                self.send_json(200, {
                    "status": "scanning",
                    "device_index": device_index,
                    "gain": gain
                })

        elif self.path == "/scan/cancel":
            cancel_scan()
            self.send_json(200, {"status": "cancelled"})

        elif self.path == "/settings":
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {}
            if "gain" in data:
                current_gain = int(data["gain"])
                print(f"[server] Gain set to {current_gain}")
            self.send_json(200, {
                "gain": current_gain,
            })

        else:
            # Proxy POST to welle-cli (e.g., /channel)
            result = proxy_to_welle("POST", self.path, body)
            if result is not None:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(result)))
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(result)
            else:
                self.send_json(503, {"error": "welle-cli not running or no response"})


def main():
    server = http.server.HTTPServer(("0.0.0.0", MGMT_PORT), Handler)
    print(f"dab-server management API listening on port {MGMT_PORT}")
    print(f"welle-cli will use port {WELLE_PORT} when started")
    print(f"rtl_tcp base port: {RTL_TCP_BASE_PORT}")
    print(f"Default gain: {current_gain} (-1 = AGC)")

    def shutdown_handler(signum, frame):
        print("Received shutdown signal")
        stop_welle()
        cancel_scan()
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    server.serve_forever()


if __name__ == "__main__":
    main()
