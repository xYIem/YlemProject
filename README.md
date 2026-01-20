# 📺 Ylem TV & Game Hub

A personal streaming and multiplayer gaming platform featuring:
- **TV Channels** - Stream your media library via ErsatzTV
- **Game Hub** - Multiplayer Boggle with wagering system
- **CRT Pi Client** - Vintage TV experience via Raspberry Pi
- **EPG Guide** - Electronic Program Guide with real-time data

## 🚀 Quick Start

### Prerequisites
- Windows 10/11 PC
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [ErsatzTV](https://ersatztv.org/) running (port 8409)
- Domain name (optional, for external access)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/xYIem/YlemProject.git
   cd ylem
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings (especially HOST_IP)
   ```

3. **Start services**
   ```bash
   docker-compose up -d
   ```

4. **Configure Nginx Proxy Manager**
   - Open http://localhost:81
   - Login (default: admin@example.com / changeme)
   - Add Proxy Host for your domain
   - Paste contents of `setup/templates/nginx-advanced.conf.template` into Advanced tab
   - Replace `__HOST_IP__`, `__ERSATZTV_PORT__`, etc. with your values

5. **Access your site**
   - Local: http://localhost (or your HOST_IP)
   - External: https://yourdomain.com (after setting up SSL)

## 📁 Project Structure

```
ylem/
├── .env.example          # Configuration template
├── docker-compose.yml    # Docker services
├── data/                 # NPM web root (index.html, watch.html)
├── web/v2/               # Game Hub frontend
├── epg-server/           # EPG data server
├── game-server/          # WebSocket game server
├── diagnostics/          # Monitoring dashboard
├── pi-client/            # Raspberry Pi CRT setup
├── scripts/              # Backup & maintenance scripts
└── docs/                 # Additional documentation
```

## 🎮 Features

### TV Streaming
- Channel selector with thumbnails
- Live EPG guide
- HLS video player
- Web and Pi channel separation

### Game Hub
- Multiplayer Boggle
- Player accounts with inventory
- Wager system with virtual currency
- Leaderboards

### Raspberry Pi CRT Client
- IR remote control support
- Composite video output
- Auto-start on boot
- Diagnostics reporting

## 🔧 Configuration

### Key Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HOST_IP` | Your PC's local IP | - |
| `DOMAIN` | Your domain name | - |
| `ERSATZTV_PORT` | ErsatzTV port | 8409 |
| `GAME_SERVER_PORT` | WebSocket port | 3000 |
| `EPG_SERVER_PORT` | EPG API port | 3001 |

### Test Instance
To run a test instance alongside production:
```bash
# Create test .env with different ports
NPM_HTTP_PORT=8080
NPM_ADMIN_PORT=8181
GAME_SERVER_PORT=3100
EPG_SERVER_PORT=3101
```

## 💾 Backups

### Automatic Backups
Run `scripts/backup-player-data.ps1` daily via Task Scheduler:
```powershell
# In Task Scheduler, create task to run at 3:00 AM
powershell.exe -ExecutionPolicy Bypass -File C:\ylem\scripts\backup-player-data.ps1
```

### Critical Files to Backup
- `game-server/items.json` - Player accounts & inventories
- `game-server/leaderboard.json` - Game scores
- ErsatzTV database (`%AppData%\ersatztv\`)

## 🌐 Dynamic DNS

For changing public IPs, use DuckDNS:

1. Create account at [duckdns.org](https://www.duckdns.org/)
2. Add subdomain
3. Configure `.env`:
   ```
   DUCKDNS_ENABLED=true
   DUCKDNS_SUBDOMAIN=your-subdomain
   DUCKDNS_TOKEN=your-token
   ```
4. Schedule `scripts/update-duckdns.ps1` every 5 minutes

## 📺 Raspberry Pi Setup

See `pi-client/` for CRT TV setup:

```bash
# On Pi, run setup script
./pi_setup.sh YOUR_HOST_IP 2000
```

## 📄 License

Private project - not for redistribution.

## 🙏 Credits

- [ErsatzTV](https://ersatztv.org/) - TV streaming backend
- [Nginx Proxy Manager](https://nginxproxymanager.com/) - Reverse proxy
- [MPV](https://mpv.io/) - Video player
