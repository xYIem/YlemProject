#!/usr/bin/env python3
"""
Ylem Pi - Enhanced Diagnostics Reporter v2
Comprehensive WiFi + Stream + System diagnostics for CRT Pi

Now with:
- Buffer danger detection
- Bandwidth estimation
- Pixelation risk warnings
- Historical min/max tracking

Sends stats via UDP to the collector on the streaming PC.
Run on YlemPi alongside tv_control.py

Install: No dependencies needed (uses stdlib only)
Usage: python3 pi_reporter.py
"""
import socket
import json
import subprocess
import time
import re
import os
from collections import deque

# === CONFIGURATION ===
COLLECTOR_HOST = "__HOST_IP__"  # Your streaming PC
COLLECTOR_PORT = 8081             # UDP port for stats
MPV_SOCKET = "/tmp/mpvsocket"     # MPV IPC socket
REPORT_INTERVAL = 2               # Seconds between reports (faster for better tracking)
WIFI_INTERFACE = "wlan0"          # WiFi interface name

# === THRESHOLDS ===
BUFFER_DANGER_SEC = 1.5           # Buffer below this = pixelation risk
BUFFER_CRITICAL_SEC = 0.5         # Buffer below this = almost certain pixelation
SIGNAL_WEAK_DBM = -70             # Signal weaker than this = potential issues
SIGNAL_BAD_DBM = -75              # Signal weaker than this = likely issues
MIN_BITRATE_MBPS = 5.0            # Minimum expected stream bitrate


def run_cmd(cmd):
    """Run shell command and return output"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return None


def mpv_get(property_name):
    """Get MPV property via JSON IPC socket"""
    if not os.path.exists(MPV_SOCKET):
        return None

    # Use JSON IPC protocol
    cmd = f'echo \'{{"command": ["get_property", "{property_name}"]}}\' | socat - {MPV_SOCKET} 2>/dev/null'
    result = run_cmd(cmd)

    if not result:
        return None

    try:
        data = json.loads(result)
        if data.get("error") == "success":
            return data.get("data")
    except (json.JSONDecodeError, TypeError):
        pass

    return None


def get_wifi_stats():
    """Get detailed WiFi diagnostics"""
    stats = {}

    # === iwconfig - signal, quality, bitrate ===
    iwconfig = run_cmd(f"iwconfig {WIFI_INTERFACE} 2>/dev/null")
    if iwconfig:
        # ESSID (network name)
        match = re.search(r'ESSID:"([^"]*)"', iwconfig)
        if match:
            stats["essid"] = match.group(1)

        # Signal level: -45 dBm (or Signal level=XX/100)
        match = re.search(r'Signal level[=:](-?\d+)', iwconfig)
        if match:
            stats["signal_dbm"] = int(match.group(1))

        # Link Quality: 70/70
        match = re.search(r'Link Quality[=:](\d+)/(\d+)', iwconfig)
        if match:
            quality = int(match.group(1))
            quality_max = int(match.group(2))
            stats["link_quality"] = quality
            stats["link_quality_max"] = quality_max
            stats["link_quality_pct"] = round(quality / quality_max * 100) if quality_max > 0 else 0

        # Bit Rate: 72.2 Mb/s
        match = re.search(r'Bit Rate[=:](\d+\.?\d*)\s*Mb', iwconfig)
        if match:
            stats["bitrate_mbps"] = float(match.group(1))

        # Frequency
        match = re.search(r'Frequency[=:](\d+\.?\d*)\s*GHz', iwconfig)
        if match:
            stats["frequency_ghz"] = float(match.group(1))

    # === /proc/net/wireless - additional stats ===
    wireless = run_cmd("cat /proc/net/wireless 2>/dev/null")
    if wireless:
        lines = wireless.strip().split('\n')
        if len(lines) >= 3:
            # Format: wlan0: status link level noise nwid crypt frag retry misc beacon
            parts = lines[2].split()
            if len(parts) >= 5:
                # Noise level (often -256 if not available)
                noise = int(float(parts[4].rstrip('.')))
                if noise != -256:
                    stats["noise_dbm"] = noise

    # === iw station dump - retries, failures ===
    iw_station = run_cmd(f"iw dev {WIFI_INTERFACE} station dump 2>/dev/null")
    if iw_station:
        # tx retries
        match = re.search(r'tx retries:\s*(\d+)', iw_station)
        if match:
            stats["tx_retries"] = int(match.group(1))

        # tx failed
        match = re.search(r'tx failed:\s*(\d+)', iw_station)
        if match:
            stats["tx_failed"] = int(match.group(1))

        # signal avg (sometimes more stable than instant)
        match = re.search(r'signal avg:\s*(-?\d+)', iw_station)
        if match:
            stats["signal_avg_dbm"] = int(match.group(1))

        # beacon loss count
        match = re.search(r'beacon loss:\s*(\d+)', iw_station)
        if match:
            stats["beacon_loss"] = int(match.group(1))

    return stats


def get_mpv_stats():
    """Get MPV playback diagnostics"""
    stats = {}

    # === Basic playback info ===
    stats["path"] = mpv_get("path")
    stats["paused"] = mpv_get("pause")

    # Playback time
    pt = mpv_get("playback-time")
    if pt is not None:
        stats["playback_time"] = round(pt, 1) if isinstance(pt, (int, float)) else pt

    # === Frame drops - KEY METRICS ===
    dropped = mpv_get("frame-drop-count")
    if dropped is not None:
        stats["dropped_frames"] = int(dropped) if isinstance(dropped, (int, float)) else dropped

    decoder_dropped = mpv_get("decoder-frame-drop-count")
    if decoder_dropped is not None:
        stats["decoder_dropped"] = int(decoder_dropped) if isinstance(decoder_dropped, (int, float)) else decoder_dropped

    # FPS
    fps = mpv_get("estimated-vf-fps")
    if fps is not None:
        stats["fps"] = round(fps, 2) if isinstance(fps, (int, float)) else fps

    # === Buffer/cache state - CRITICAL for streaming ===
    # paused-for-cache: true means currently buffering/stalled!
    cache_pause = mpv_get("paused-for-cache")
    stats["buffering"] = cache_pause is True

    # Demuxer cache duration (seconds of video buffered ahead)
    cache_dur = mpv_get("demuxer-cache-duration")
    if cache_dur is not None:
        stats["cache_duration_sec"] = round(cache_dur, 1) if isinstance(cache_dur, (int, float)) else cache_dur

    # Cache speed (bytes/sec coming in)
    cache_speed = mpv_get("cache-speed")
    if cache_speed is not None and isinstance(cache_speed, (int, float)):
        # Convert to Mbps
        stats["cache_speed_mbps"] = round(cache_speed * 8 / 1_000_000, 2)

    # === A/V sync ===
    avsync = mpv_get("avsync")
    if avsync is not None and isinstance(avsync, (int, float)):
        stats["av_sync_ms"] = round(avsync * 1000, 1)

    # === Bitrates ===
    vbr = mpv_get("video-bitrate")
    if vbr is not None and isinstance(vbr, (int, float)):
        stats["video_bitrate_mbps"] = round(vbr / 1_000_000, 2)

    return stats


def get_system_stats():
    """Get Pi system stats"""
    stats = {}

    # === CPU Temperature ===
    temp = run_cmd("vcgencmd measure_temp")
    if temp:
        match = re.search(r'temp=([\d.]+)', temp)
        if match:
            stats["cpu_temp_c"] = float(match.group(1))

    # === Throttling state - IMPORTANT! ===
    throttle = run_cmd("vcgencmd get_throttled")
    if throttle:
        match = re.search(r'throttled=(0x[0-9a-fA-F]+)', throttle)
        if match:
            val = int(match.group(1), 16)
            # Bit flags:
            # 0: Under-voltage detected
            # 1: Arm frequency capped
            # 2: Currently throttled
            # 16: Under-voltage has occurred
            # 17: Arm frequency capping has occurred
            # 18: Throttling has occurred
            stats["throttle_flags"] = hex(val)
            stats["undervolt_now"] = bool(val & 0x1)
            stats["freq_capped_now"] = bool(val & 0x2)
            stats["throttled_now"] = bool(val & 0x4)
            stats["undervolt_occurred"] = bool(val & 0x10000)
            stats["throttled_occurred"] = bool(val & 0x40000)

    # === CPU Frequency ===
    freq = run_cmd("vcgencmd measure_clock arm")
    if freq:
        match = re.search(r'=(\d+)', freq)
        if match:
            stats["cpu_freq_mhz"] = int(match.group(1)) // 1_000_000

    # === Memory ===
    mem = run_cmd("free -m")
    if mem:
        lines = mem.strip().split('\n')
        for line in lines:
            if line.startswith('Mem:'):
                parts = line.split()
                if len(parts) >= 3:
                    stats["mem_total_mb"] = int(parts[1])
                    stats["mem_used_mb"] = int(parts[2])
                    stats["mem_pct"] = round(int(parts[2]) / int(parts[1]) * 100)

    # === Uptime ===
    uptime = run_cmd("cat /proc/uptime")
    if uptime:
        parts = uptime.split()
        if parts:
            stats["uptime_sec"] = int(float(parts[0]))

    return stats


def get_network_stats():
    """Get network interface statistics (for rate calculations)"""
    stats = {}

    base = f"/sys/class/net/{WIFI_INTERFACE}/statistics"

    metrics = [
        ("rx_bytes", "rx_bytes"),
        ("tx_bytes", "tx_bytes"),
        ("rx_packets", "rx_packets"),
        ("tx_packets", "tx_packets"),
        ("rx_errors", "rx_errors"),
        ("tx_errors", "tx_errors"),
        ("rx_dropped", "rx_dropped"),
        ("tx_dropped", "tx_dropped"),
    ]

    for filename, key in metrics:
        value = run_cmd(f"cat {base}/{filename} 2>/dev/null")
        if value:
            try:
                stats[key] = int(value)
            except ValueError:
                pass

    return stats


class RateCalculator:
    """Calculate rates between samples"""
    def __init__(self):
        self.last_time = 0
        self.last_rx_bytes = 0
        self.last_tx_retries = 0
        self.last_dropped = 0
        # Rolling history for min/max tracking
        self.buffer_history = deque(maxlen=30)  # Last 30 samples (~1 min at 2s intervals)
        self.signal_history = deque(maxlen=30)
        self.rx_rate_history = deque(maxlen=30)
        # Event counters
        self.buffer_danger_count = 0
        self.buffer_critical_count = 0
        self.pixelation_risk_events = []

    def calculate(self, network, wifi, mpv):
        """Return calculated rates and risk assessments"""
        rates = {}
        now = time.time()
        elapsed = now - self.last_time if self.last_time > 0 else 0

        if elapsed > 0:
            # Receive rate (Mbps)
            rx_bytes = network.get("rx_bytes", 0)
            if self.last_rx_bytes > 0 and rx_bytes >= self.last_rx_bytes:
                rx_delta = rx_bytes - self.last_rx_bytes
                rx_rate = rx_delta * 8 / elapsed / 1_000_000
                rates["rx_rate_mbps"] = round(rx_rate, 2)
                self.rx_rate_history.append(rx_rate)
            self.last_rx_bytes = rx_bytes

            # New retries since last sample
            retries = wifi.get("tx_retries", 0)
            if self.last_tx_retries > 0 and retries >= self.last_tx_retries:
                rates["new_retries"] = retries - self.last_tx_retries
                rates["retries_per_sec"] = round((retries - self.last_tx_retries) / elapsed, 1)
            self.last_tx_retries = retries

            # New dropped frames since last sample
            dropped = mpv.get("dropped_frames", 0)
            if isinstance(dropped, int) and self.last_dropped > 0:
                rates["new_drops"] = max(0, dropped - self.last_dropped)
            if isinstance(dropped, int):
                self.last_dropped = dropped

        self.last_time = now

        # === TRACK HISTORY ===
        buffer_sec = mpv.get("cache_duration_sec")
        if buffer_sec is not None:
            self.buffer_history.append(buffer_sec)

        signal_dbm = wifi.get("signal_dbm")
        if signal_dbm is not None:
            self.signal_history.append(signal_dbm)

        # === CALCULATE STATS ===
        if self.buffer_history:
            rates["buffer_min"] = round(min(self.buffer_history), 1)
            rates["buffer_max"] = round(max(self.buffer_history), 1)
            rates["buffer_avg"] = round(sum(self.buffer_history) / len(self.buffer_history), 1)

        if self.signal_history:
            rates["signal_min"] = min(self.signal_history)
            rates["signal_max"] = max(self.signal_history)
            rates["signal_avg"] = round(sum(self.signal_history) / len(self.signal_history))

        if self.rx_rate_history:
            rates["rx_rate_min"] = round(min(self.rx_rate_history), 2)
            rates["rx_rate_max"] = round(max(self.rx_rate_history), 2)
            rates["rx_rate_avg"] = round(sum(self.rx_rate_history) / len(self.rx_rate_history), 2)

        # === RISK ASSESSMENT ===
        risk_level = "ok"
        risk_reasons = []

        # Buffer checks
        if buffer_sec is not None:
            if buffer_sec < BUFFER_CRITICAL_SEC:
                risk_level = "critical"
                risk_reasons.append(f"Buffer critical: {buffer_sec:.1f}s")
                self.buffer_critical_count += 1
            elif buffer_sec < BUFFER_DANGER_SEC:
                if risk_level != "critical":
                    risk_level = "danger"
                risk_reasons.append(f"Buffer low: {buffer_sec:.1f}s")
                self.buffer_danger_count += 1

        # Signal checks
        if signal_dbm is not None:
            if signal_dbm < SIGNAL_BAD_DBM:
                if risk_level == "ok":
                    risk_level = "danger"
                risk_reasons.append(f"Weak signal: {signal_dbm} dBm")
            elif signal_dbm < SIGNAL_WEAK_DBM:
                if risk_level == "ok":
                    risk_level = "warning"
                risk_reasons.append(f"Fair signal: {signal_dbm} dBm")

        # Bandwidth check
        rx_rate = rates.get("rx_rate_mbps", 0)
        if rx_rate > 0 and rx_rate < MIN_BITRATE_MBPS:
            if risk_level == "ok":
                risk_level = "warning"
            risk_reasons.append(f"Low bandwidth: {rx_rate:.1f} Mbps")

        # Buffering check (most severe)
        if mpv.get("buffering"):
            risk_level = "critical"
            risk_reasons.append("Currently buffering!")

        rates["risk_level"] = risk_level
        rates["risk_reasons"] = risk_reasons
        rates["buffer_danger_count"] = self.buffer_danger_count
        rates["buffer_critical_count"] = self.buffer_critical_count

        # Log pixelation risk events
        if risk_level in ["danger", "critical"]:
            event = {
                "time": now,
                "level": risk_level,
                "buffer": buffer_sec,
                "signal": signal_dbm,
                "rx_rate": rx_rate,
                "reasons": risk_reasons
            }
            self.pixelation_risk_events.append(event)
            # Keep last 100 events
            if len(self.pixelation_risk_events) > 100:
                self.pixelation_risk_events = self.pixelation_risk_events[-100:]

        rates["recent_risk_events"] = len([e for e in self.pixelation_risk_events if now - e["time"] < 300])  # Last 5 min

        return rates


def signal_quality(dbm):
    """Convert dBm to quality description"""
    if dbm is None:
        return "unknown"
    if dbm >= -50:
        return "excellent"
    if dbm >= -60:
        return "good"
    if dbm >= -70:
        return "fair"
    if dbm >= -80:
        return "weak"
    return "poor"


def main():
    # Create UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rate_calc = RateCalculator()

    print("=" * 70)
    print("📊 YLEM PI - ENHANCED DIAGNOSTICS REPORTER v2")
    print("=" * 70)
    print(f"  Collector: {COLLECTOR_HOST}:{COLLECTOR_PORT}")
    print(f"  Interval:  {REPORT_INTERVAL} seconds")
    print(f"  MPV Socket: {MPV_SOCKET}")
    print("-" * 70)
    print("  Thresholds:")
    print(f"    Buffer Danger:   < {BUFFER_DANGER_SEC}s")
    print(f"    Buffer Critical: < {BUFFER_CRITICAL_SEC}s")
    print(f"    Signal Weak:     < {SIGNAL_WEAK_DBM} dBm")
    print(f"    Signal Bad:      < {SIGNAL_BAD_DBM} dBm")
    print("-" * 70)

    while True:
        try:
            # Gather all stats
            wifi = get_wifi_stats()
            mpv = get_mpv_stats()
            system = get_system_stats()
            network = get_network_stats()
            rates = rate_calc.calculate(network, wifi, mpv)

            # Compile full report
            report = {
                "timestamp": time.time(),
                "hostname": "YlemPi",
                "wifi": wifi,
                "mpv": mpv,
                "system": system,
                "network": network,
                "rates": rates,
            }

            # Send to collector
            data = json.dumps(report).encode()
            sock.sendto(data, (COLLECTOR_HOST, COLLECTOR_PORT))

            # === Local console summary ===
            # Extract channel from path
            channel = "N/A"
            path = mpv.get("path")
            if path:
                match = re.search(r'/channel/(\d+)', path)
                if match:
                    channel = match.group(1)

            # Build status line
            sig = wifi.get("signal_dbm", "?")
            qual = wifi.get("link_quality_pct", "?")
            drops = mpv.get("dropped_frames", "?")
            new_drops = rates.get("new_drops", 0)
            cache = mpv.get("cache_duration_sec", "?")
            rx_rate = rates.get("rx_rate_mbps", "?")
            temp = system.get("cpu_temp_c", "?")

            # Risk indicator
            risk = rates.get("risk_level", "ok")
            risk_icon = {"ok": "✅", "warning": "⚠️ ", "danger": "🟠", "critical": "🔴"}.get(risk, "?")

            drop_indicator = f"(+{new_drops})" if new_drops > 0 else ""
            cache_str = f"{cache:.1f}" if isinstance(cache, float) else str(cache)

            # Color the output based on risk
            print(f"{risk_icon} Ch:{channel:4} | "
                  f"📶 {sig}dBm {qual}% | "
                  f"📦 Buf:{cache_str}s | "
                  f"⬇️ {rx_rate}Mbps | "
                  f"🎬 Drop:{drops}{drop_indicator} | "
                  f"🌡️ {temp}°C", end="")

            if rates.get("risk_reasons"):
                print(f" | ⚠️  {', '.join(rates['risk_reasons'])}")
            else:
                print()

        except Exception as e:
            print(f"❌ Error: {e}")

        time.sleep(REPORT_INTERVAL)


if __name__ == "__main__":
    main()