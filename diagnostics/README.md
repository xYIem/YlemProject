# Ylem Streaming Diagnostics

Real-time monitoring dashboard for Ylem TV streaming infrastructure.

## What It Monitors

### CRT Pi (YlemPi)
- **WiFi Signal**: Signal strength (dBm), link quality %, bitrate, TX retries
- **Stream Health**: Dropped frames, buffer duration, buffering status, download rate
- **System**: CPU temperature, throttling, memory usage, uptime

### Streaming Server (YOUR_HOST_IP)
- CPU and memory usage
- ErsatzTV process status
- Disk space

### Docker Containers
- NPM (nginx proxy manager) health
- Game server health

### Network
- Pi reachability
- Ping latency

---

## Installation

### Step 1: Server Setup (Windows PC)

1. **Copy files to your streaming PC:**
   ```powershell
   # Create directory
   mkdir C:\npm\diagnostics
   mkdir C:\npm\diagnostics\static
   
   # Copy files
   copy collector.py C:\npm\diagnostics\
   copy requirements.txt C:\npm\diagnostics\
   copy static\dashboard.html C:\npm\diagnostics\static\
   ```

2. **Install Python dependencies:**
   ```powershell
   cd C:\npm\diagnostics
   pip install -r requirements.txt
   ```

3. **Run the collector:**
   ```powershell
   python collector.py
   ```

4. **Open dashboard:**
   - http://localhost:8080

### Step 2: Pi Setup (YlemPi)

1. **Copy the reporter script:**
   ```bash
   # From your PC (or use SCP)
   scp pi_reporter.py ylem@YlemPi.local:~/
   ```

2. **SSH to Pi and make executable:**
   ```bash
   ssh ylem@YlemPi.local
   chmod +x ~/pi_reporter.py
   ```

3. **Install socat (if not present):**
   ```bash
   sudo apt install socat
   ```

4. **Test it:**
   ```bash
   python3 ~/pi_reporter.py
   ```
   You should see stats being reported every 5 seconds.

5. **Set up autostart:**
   ```bash
   # Copy the desktop file
   cp PiReporter.desktop ~/.config/autostart/
   
   # Or create manually:
   cat > ~/.config/autostart/PiReporter.desktop << 'EOF'
   [Desktop Entry]
   Type=Application
   Name=Ylem Pi Diagnostics Reporter
   Exec=/usr/bin/python3 /home/ylem/pi_reporter.py
   Terminal=false
   StartupNotify=false
   X-GNOME-Autostart-enabled=true
   EOF
   ```

6. **Reboot to verify autostart:**
   ```bash
   sudo reboot
   ```

---

## File Structure

```
C:\npm\diagnostics\           (Windows PC)
├── collector.py              # Main collector & web server
├── requirements.txt          # Python dependencies
└── static\
    └── dashboard.html        # Web dashboard

~/                            (YlemPi)
├── pi_reporter.py            # Stats reporter
└── .config/autostart/
    └── PiReporter.desktop    # Autostart config
```

---

## Ports Used

| Port | Purpose | Host |
|------|---------|------|
| 8080 | Dashboard web server | Streaming PC |
| 8081 | UDP stats from Pi | Streaming PC |

---

## Troubleshooting

### Pi not showing up in dashboard

1. **Check Pi reporter is running:**
   ```bash
   ssh ylem@YlemPi.local
   ps aux | grep pi_reporter
   ```

2. **Check MPV socket exists:**
   ```bash
   ls -la /tmp/mpvsocket
   ```

3. **Test socat:**
   ```bash
   echo 'print_text ${path}' | socat - /tmp/mpvsocket
   ```

4. **Check network connectivity:**
   ```bash
   ping YOUR_HOST_IP
   ```

5. **Check UDP port is open on server:**
   ```powershell
   # On Windows, check if collector is listening
   netstat -an | findstr 8081
   ```

### Dashboard shows stale data

- Check that collector.py is still running
- Verify Pi reporter is sending (check console output)
- Browser console for JavaScript errors

### WiFi stats missing

Some WiFi stats require the `iw` tool:
```bash
sudo apt install iw
```

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard HTML |
| `GET /api/stats` | All collected stats (JSON) |
| `GET /api/pi` | Pi stats only |
| `GET /api/pi/history` | Pi history for graphs |
| `GET /api/health` | Quick health check |
| `GET /api/alerts` | Current alerts |

---

## Customization

### Change update interval

In `pi_reporter.py`:
```python
REPORT_INTERVAL = 5  # Change to desired seconds
```

In `dashboard.html`:
```javascript
setInterval(updateDashboard, 5000);  // Change milliseconds
```

### Add alert thresholds

In `collector.py`, modify `check_alerts()`:
```python
if server.get("cpu_percent", 0) > 85:  # Change threshold
    alerts.append(...)
```

---

## Running as a Service (Optional)

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task: "Ylem Diagnostics"
3. Trigger: At startup
4. Action: Start a program
   - Program: `python`
   - Arguments: `C:\npm\diagnostics\collector.py`
   - Start in: `C:\npm\diagnostics`

### Linux (systemd)

```bash
sudo nano /etc/systemd/system/ylem-diagnostics.service
```

```ini
[Unit]
Description=Ylem Diagnostics Collector
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/diagnostics
ExecStart=/usr/bin/python3 collector.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ylem-diagnostics
sudo systemctl start ylem-diagnostics
```

---

**Last Updated**: January 18, 2026
