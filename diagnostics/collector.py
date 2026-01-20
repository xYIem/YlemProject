#!/usr/bin/env python3
"""
Ylem Streaming Diagnostics - Data Collector & Dashboard Server
Runs on the streaming PC (configure HOST_IP in .env)

Collects stats from:
- Local system (CPU, memory, disk)
- Docker containers (NPM, game server)
- Network (ping to Pi)
- YlemPi (via UDP from pi_reporter.py)

Serves a real-time dashboard on port 8080.

Install: pip install flask psutil
Usage: python collector.py
"""
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import threading
import socket
import json
import time
import subprocess
import os
import sys

# Try to import psutil, provide helpful message if missing
try:
    import psutil
except ImportError:
    print("ERROR: psutil not installed.")
    print("Install with: pip install psutil")
    sys.exit(1)

app = Flask(__name__, static_folder='static')
CORS(app)

# === CONFIGURATION ===
PI_HOSTNAME = "YlemPi.local"
UDP_PORT = 8081
DASHBOARD_PORT = 8080
ERSATZTV_PORT = 8409

# === GLOBAL STATE ===
state = {
    "server": {},
    "docker": {},
    "network": {},
    "pi": {},
    "pi_history": [],  # Rolling history for graphs
    "pi_raw_log": [],  # Raw log entries (like terminal output)
    "alerts": [],
    "last_update": 0,
}

# History settings
MAX_HISTORY = 43200  # 24 hours at 2-second intervals (24 * 60 * 60 / 2)
MAX_RAW_LOG = 43200  # 24 hours of raw log entries


# ============== DATA COLLECTORS ==============

def collect_server_stats():
    """Collect Windows/Linux PC stats"""
    while True:
        try:
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            
            # Disk space (C: on Windows, / on Linux)
            disk_path = 'C:\\' if os.name == 'nt' else '/'
            disk = psutil.disk_usage(disk_path)
            
            state["server"] = {
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "memory_used_gb": round(memory.used / (1024**3), 1),
                "memory_total_gb": round(memory.total / (1024**3), 1),
                "disk_free_gb": round(disk.free / (1024**3), 1),
                "disk_total_gb": round(disk.total / (1024**3), 1),
                "disk_percent": disk.percent,
                "timestamp": time.time(),
            }
            
            # Find ErsatzTV process
            for proc in psutil.process_iter(['name', 'cpu_percent', 'memory_percent', 'pid']):
                try:
                    name = proc.info['name'].lower()
                    if 'ersatztv' in name:
                        state["server"]["ersatztv_running"] = True
                        state["server"]["ersatztv_pid"] = proc.info['pid']
                        state["server"]["ersatztv_cpu"] = proc.info['cpu_percent']
                        state["server"]["ersatztv_mem"] = proc.info['memory_percent']
                        break
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            else:
                state["server"]["ersatztv_running"] = False
                
        except Exception as e:
            print(f"[Server] Error: {e}")
        
        time.sleep(5)


def collect_docker_stats():
    """Collect Docker container stats"""
    while True:
        try:
            # Get container list
            result = subprocess.run(
                ['docker', 'ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.State}}'],
                capture_output=True, text=True, timeout=10
            )
            
            containers = {}
            for line in result.stdout.strip().split('\n'):
                if line:
                    parts = line.split('\t')
                    if len(parts) >= 3:
                        name = parts[0]
                        containers[name] = {
                            "status": parts[1],
                            "state": parts[2],
                            "healthy": parts[2] == "running"
                        }
            
            state["docker"] = {
                "containers": containers,
                "npm_healthy": containers.get("npm-app-1", {}).get("healthy", False),
                "game_server_healthy": containers.get("npm-game-server-1", {}).get("healthy", False),
                "timestamp": time.time(),
            }
            
        except FileNotFoundError:
            state["docker"] = {"error": "Docker not found", "timestamp": time.time()}
        except subprocess.TimeoutExpired:
            state["docker"] = {"error": "Docker timeout", "timestamp": time.time()}
        except Exception as e:
            state["docker"] = {"error": str(e), "timestamp": time.time()}
        
        time.sleep(10)


def collect_network_stats():
    """Ping the Pi and check network"""
    while True:
        try:
            # Ping command differs by OS
            if os.name == 'nt':  # Windows
                cmd = ['ping', '-n', '1', '-w', '2000', PI_HOSTNAME]
            else:  # Linux/Mac
                cmd = ['ping', '-c', '1', '-W', '2', PI_HOSTNAME]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            
            latency = None
            if result.returncode == 0:
                # Parse ping output for latency
                output = result.stdout
                # Windows: time=XXms or time<1ms
                # Linux: time=XX.X ms
                match = None
                import re
                match = re.search(r'time[=<](\d+\.?\d*)\s*ms', output, re.IGNORECASE)
                if match:
                    latency = float(match.group(1))
            
            state["network"] = {
                "pi_reachable": result.returncode == 0,
                "pi_latency_ms": latency,
                "pi_hostname": PI_HOSTNAME,
                "timestamp": time.time(),
            }
            
        except subprocess.TimeoutExpired:
            state["network"] = {
                "pi_reachable": False,
                "error": "Ping timeout",
                "timestamp": time.time(),
            }
        except Exception as e:
            state["network"] = {
                "pi_reachable": False,
                "error": str(e),
                "timestamp": time.time(),
            }
        
        time.sleep(10)


def receive_pi_stats():
    """UDP listener for Pi reporter"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        sock.bind(("0.0.0.0", UDP_PORT))
        print(f"📡 Listening for Pi stats on UDP port {UDP_PORT}")
    except OSError as e:
        print(f"❌ Could not bind UDP port {UDP_PORT}: {e}")
        return
    
    while True:
        try:
            data, addr = sock.recvfrom(8192)
            stats = json.loads(data.decode())
            stats["received_at"] = time.time()
            stats["source_ip"] = addr[0]
            state["pi"] = stats
            
            # Add to history (for graphs)
            history_entry = {
                "timestamp": stats.get("timestamp", time.time()),
                "signal_dbm": stats.get("wifi", {}).get("signal_dbm"),
                "link_quality_pct": stats.get("wifi", {}).get("link_quality_pct"),
                "dropped_frames": stats.get("mpv", {}).get("dropped_frames"),
                "cache_duration": stats.get("mpv", {}).get("cache_duration_sec"),
                "cpu_temp": stats.get("system", {}).get("cpu_temp_c"),
                "rx_rate_mbps": stats.get("rates", {}).get("rx_rate_mbps"),
                "buffering": stats.get("mpv", {}).get("buffering", False),
            }
            state["pi_history"].append(history_entry)
            
            # Trim history
            if len(state["pi_history"]) > MAX_HISTORY:
                state["pi_history"] = state["pi_history"][-MAX_HISTORY:]
            
            # Add raw log entry (like terminal output)
            wifi = stats.get("wifi", {})
            mpv = stats.get("mpv", {})
            system = stats.get("system", {})
            rates = stats.get("rates", {})
            
            # Extract channel from path
            channel = "N/A"
            path = mpv.get("path", "")
            if path:
                import re
                match = re.search(r'/channel/(\d+)', path)
                if match:
                    channel = match.group(1)
            
            risk_level = rates.get("risk_level", "ok")
            risk_icon = {"ok": "✅", "warning": "⚠️", "danger": "🟠", "critical": "🔴"}.get(risk_level, "?")
            
            raw_entry = {
                "timestamp": stats.get("timestamp", time.time()),
                "icon": risk_icon,
                "channel": channel,
                "signal_dbm": wifi.get("signal_dbm"),
                "quality_pct": wifi.get("link_quality_pct"),
                "buffer_sec": mpv.get("cache_duration_sec"),
                "rx_rate_mbps": rates.get("rx_rate_mbps"),
                "video_bitrate_kbps": round(mpv.get("video_bitrate_mbps", 0) * 1000) if mpv.get("video_bitrate_mbps") else None,
                "dropped_frames": mpv.get("dropped_frames"),
                "cpu_temp": system.get("cpu_temp_c"),
                "risk_level": risk_level,
                "risk_reasons": rates.get("risk_reasons", []),
            }
            state["pi_raw_log"].append(raw_entry)
            
            # Trim raw log
            if len(state["pi_raw_log"]) > MAX_RAW_LOG:
                state["pi_raw_log"] = state["pi_raw_log"][-MAX_RAW_LOG:]
            
        except json.JSONDecodeError:
            print("[Pi] Invalid JSON received")
        except Exception as e:
            print(f"[Pi] Receive error: {e}")


def check_alerts():
    """Generate alerts based on current state"""
    while True:
        try:
            alerts = []
            now = time.time()
            
            # Server alerts
            server = state.get("server", {})
            if server.get("cpu_percent", 0) > 85:
                alerts.append({"level": "warning", "message": f"High CPU: {server['cpu_percent']:.0f}%"})
            if server.get("memory_percent", 0) > 90:
                alerts.append({"level": "warning", "message": f"High memory: {server['memory_percent']:.0f}%"})
            if server.get("disk_percent", 0) > 90:
                alerts.append({"level": "warning", "message": f"Low disk space: {100-server['disk_percent']:.0f}% free"})
            if not server.get("ersatztv_running", True):
                alerts.append({"level": "error", "message": "ErsatzTV not running"})
            
            # Docker alerts
            docker = state.get("docker", {})
            if not docker.get("npm_healthy", True):
                alerts.append({"level": "error", "message": "NPM container down"})
            if not docker.get("game_server_healthy", True):
                alerts.append({"level": "warning", "message": "Game server container down"})
            
            # Pi alerts
            pi = state.get("pi", {})
            pi_age = now - pi.get("received_at", 0)
            if pi_age > 30:
                alerts.append({"level": "error", "message": f"Pi not reporting ({int(pi_age)}s ago)"})
            else:
                # WiFi alerts
                wifi = pi.get("wifi", {})
                signal = wifi.get("signal_dbm")
                if signal is not None and signal < -75:
                    alerts.append({"level": "warning", "message": f"Weak WiFi signal: {signal} dBm"})
                
                # Playback alerts
                mpv = pi.get("mpv", {})
                if mpv.get("buffering"):
                    alerts.append({"level": "error", "message": "Pi is buffering!"})
                
                cache = mpv.get("cache_duration_sec")
                if cache is not None and cache < 2:
                    alerts.append({"level": "warning", "message": f"Low buffer: {cache}s"})
                
                # System alerts
                system = pi.get("system", {})
                if system.get("throttled_now"):
                    alerts.append({"level": "error", "message": "Pi is thermal throttling!"})
                if system.get("undervolt_now"):
                    alerts.append({"level": "error", "message": "Pi undervoltage detected!"})
                temp = system.get("cpu_temp_c")
                if temp is not None and temp > 75:
                    alerts.append({"level": "warning", "message": f"Pi running hot: {temp}°C"})
            
            state["alerts"] = alerts
            
        except Exception as e:
            print(f"[Alerts] Error: {e}")
        
        time.sleep(5)


# ============== API ENDPOINTS ==============

@app.route('/api/stats')
def api_stats():
    """Return all collected stats"""
    state["last_update"] = time.time()
    return jsonify(state)


@app.route('/api/pi')
def api_pi():
    """Return just Pi stats"""
    return jsonify(state.get("pi", {}))


@app.route('/api/pi/history')
def api_pi_history():
    """Return Pi history for graphs"""
    return jsonify(state.get("pi_history", []))


@app.route('/api/health')
def api_health():
    """Quick health summary"""
    now = time.time()
    pi = state.get("pi", {})
    pi_age = now - pi.get("received_at", 0)
    
    return jsonify({
        "server_ok": state.get("server", {}).get("cpu_percent", 100) < 90,
        "docker_npm_ok": state.get("docker", {}).get("npm_healthy", False),
        "docker_game_ok": state.get("docker", {}).get("game_server_healthy", False),
        "ersatztv_ok": state.get("server", {}).get("ersatztv_running", False),
        "pi_connected": pi_age < 30,
        "pi_latency_ms": state.get("network", {}).get("pi_latency_ms"),
        "pi_buffering": pi.get("mpv", {}).get("buffering", False),
        "alert_count": len(state.get("alerts", [])),
    })


@app.route('/api/alerts')
def api_alerts():
    """Return current alerts"""
    return jsonify(state.get("alerts", []))


@app.route('/api/rawlog')
def api_rawlog():
    """Return raw log entries with pagination"""
    # Get query params
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    raw_log = state.get("pi_raw_log", [])
    total = len(raw_log)
    
    # Return newest first, with pagination
    reversed_log = list(reversed(raw_log))
    page = reversed_log[offset:offset + limit]
    
    return jsonify({
        "total": total,
        "offset": offset,
        "limit": limit,
        "entries": page
    })


@app.route('/api/history/stats')
def api_history_stats():
    """Calculate min/avg/max from history over a time range"""
    # Get time range in minutes (default 60 = 1 hour)
    minutes = request.args.get('minutes', 60, type=int)
    
    now = time.time()
    cutoff = now - (minutes * 60)
    
    raw_log = state.get("pi_raw_log", [])
    
    # Filter to time range
    filtered = [e for e in raw_log if e.get("timestamp", 0) >= cutoff]
    
    if not filtered:
        return jsonify({
            "minutes": minutes,
            "samples": 0,
            "buffer": {},
            "signal": {},
            "bandwidth": {},
            "drops": {}
        })
    
    # Extract values (filter out None)
    buffers = [e["buffer_sec"] for e in filtered if e.get("buffer_sec") is not None]
    signals = [e["signal_dbm"] for e in filtered if e.get("signal_dbm") is not None]
    bandwidths = [e["rx_rate_mbps"] for e in filtered if e.get("rx_rate_mbps") is not None]
    drops = [e["dropped_frames"] for e in filtered if e.get("dropped_frames") is not None]
    
    def calc_stats(values):
        if not values:
            return {}
        return {
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "avg": round(sum(values) / len(values), 2),
            "count": len(values)
        }
    
    # Count risk events
    warnings = len([e for e in filtered if e.get("risk_level") == "warning"])
    dangers = len([e for e in filtered if e.get("risk_level") in ["danger", "critical"]])
    
    return jsonify({
        "minutes": minutes,
        "samples": len(filtered),
        "time_range": {
            "from": min(e["timestamp"] for e in filtered),
            "to": max(e["timestamp"] for e in filtered)
        },
        "buffer": calc_stats(buffers),
        "signal": calc_stats(signals),
        "bandwidth": calc_stats(bandwidths),
        "drops": calc_stats(drops) if drops else {"min": 0, "max": 0, "total": 0},
        "risk_events": {
            "warnings": warnings,
            "dangers": dangers
        }
    })


# ============== STATIC FILES ==============

@app.route('/')
def serve_dashboard():
    """Serve the dashboard HTML"""
    return send_from_directory(app.static_folder, 'dashboard.html')


@app.route('/<path:filename>')
def serve_static(filename):
    """Serve other static files"""
    return send_from_directory(app.static_folder, filename)


# ============== MAIN ==============

def main():
    print("=" * 60)
    print("📊 YLEM STREAMING DIAGNOSTICS COLLECTOR")
    print("=" * 60)
    print(f"  Dashboard:  http://localhost:{DASHBOARD_PORT}")
    print(f"  API:        http://localhost:{DASHBOARD_PORT}/api/stats")
    print(f"  Pi UDP:     Listening on port {UDP_PORT}")
    print("-" * 60)
    
    # Verify static folder exists
    static_path = os.path.join(os.path.dirname(__file__), 'static')
    if not os.path.exists(static_path):
        os.makedirs(static_path)
        print(f"📁 Created static folder: {static_path}")
        print("   Put dashboard.html in this folder!")
    
    # Start collector threads
    threads = [
        ("Server Stats", collect_server_stats),
        ("Docker Stats", collect_docker_stats),
        ("Network Stats", collect_network_stats),
        ("Pi Receiver", receive_pi_stats),
        ("Alert Checker", check_alerts),
    ]
    
    for name, target in threads:
        t = threading.Thread(target=target, daemon=True, name=name)
        t.start()
        print(f"✅ Started: {name}")
    
    print("-" * 60)
    print("🌐 Starting web server...")
    
    # Run Flask (use threaded for concurrent requests)
    app.run(host='0.0.0.0', port=DASHBOARD_PORT, debug=False, threaded=True)


if __name__ == '__main__':
    main()
