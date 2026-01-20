#!/usr/bin/env python3
"""
Ylem Setup Wizard
A GUI application to configure and deploy the Ylem TV & Game Hub
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import socket
import subprocess
import os
import re
import shutil
from pathlib import Path

class YlemSetupWizard:
    def __init__(self, root):
        self.root = root
        self.root.title("Ylem Setup Wizard")
        self.root.geometry("700x550")
        self.root.resizable(False, False)
        
        # Configuration data
        self.config = {
            'host_ip': '',
            'domain': '',
            'npm_http_port': '80',
            'npm_https_port': '443',
            'npm_admin_port': '81',
            'game_server_port': '3000',
            'epg_server_port': '3001',
            'ersatztv_port': '8409',
            'duckdns_enabled': False,
            'duckdns_subdomain': '',
            'duckdns_token': '',
            'web_channels': '1000:Channel One,1001:Channel Two',
            'pi_channels': '2000:CRT Channel 1,2001:CRT Channel 2',
            'pi_hostname': 'YlemPi',
            'pi_user': 'ylem',
            'pi_default_channel': '2000',
            'backup_enabled': True,
            'backup_path': '',
            'install_path': 'C:\\ylem',
        }
        
        # Track current page
        self.current_page = 0
        self.pages = []
        
        # Create main container
        self.container = ttk.Frame(root, padding="10")
        self.container.pack(fill=tk.BOTH, expand=True)
        
        # Create navigation buttons
        self.nav_frame = ttk.Frame(self.container)
        self.nav_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=(10, 0))
        
        self.back_btn = ttk.Button(self.nav_frame, text="← Back", command=self.prev_page)
        self.back_btn.pack(side=tk.LEFT)
        
        self.next_btn = ttk.Button(self.nav_frame, text="Next →", command=self.next_page)
        self.next_btn.pack(side=tk.RIGHT)
        
        # Create page container
        self.page_frame = ttk.Frame(self.container)
        self.page_frame.pack(fill=tk.BOTH, expand=True)
        
        # Build all pages
        self.build_pages()
        self.show_page(0)
    
    def build_pages(self):
        """Build all wizard pages"""
        self.pages = [
            self.create_welcome_page,
            self.create_network_page,
            self.create_ports_page,
            self.create_domain_page,
            self.create_channels_page,
            self.create_pi_page,
            self.create_backup_page,
            self.create_summary_page,
            self.create_complete_page,
        ]
    
    def show_page(self, index):
        """Display a specific page"""
        # Clear current page
        for widget in self.page_frame.winfo_children():
            widget.destroy()
        
        # Update navigation buttons
        self.back_btn.config(state=tk.NORMAL if index > 0 else tk.DISABLED)
        
        if index == len(self.pages) - 2:  # Summary page
            self.next_btn.config(text="🚀 Deploy")
        elif index == len(self.pages) - 1:  # Complete page
            self.next_btn.config(text="Close", command=self.root.quit)
            self.back_btn.config(state=tk.DISABLED)
        else:
            self.next_btn.config(text="Next →")
        
        # Show the page
        self.current_page = index
        self.pages[index]()
    
    def next_page(self):
        """Go to next page"""
        if self.current_page == len(self.pages) - 2:  # Summary -> Deploy
            self.deploy()
        elif self.current_page < len(self.pages) - 1:
            self.show_page(self.current_page + 1)
    
    def prev_page(self):
        """Go to previous page"""
        if self.current_page > 0:
            self.show_page(self.current_page - 1)
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 1: Welcome
    # ─────────────────────────────────────────────────────────────────
    def create_welcome_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="🎬 Welcome to Ylem Setup", 
                  font=('Helvetica', 18, 'bold')).pack(pady=(0, 20))
        
        welcome_text = """This wizard will help you configure your Ylem TV & Game Hub.

You'll set up:
  ✓ Network configuration (IP addresses, ports)
  ✓ Domain and Dynamic DNS (optional)
  ✓ TV channels for web and Raspberry Pi
  ✓ Backup schedules

Prerequisites:
  • Docker Desktop installed and running
  • ErsatzTV running (default port 8409)
  • Internet connection for pulling Docker images

The wizard will generate all configuration files and
optionally start the Docker containers for you."""
        
        ttk.Label(frame, text=welcome_text, justify=tk.LEFT, 
                  font=('Consolas', 10)).pack(pady=10, anchor='w')
        
        # Install path
        path_frame = ttk.LabelFrame(frame, text="Installation Path", padding="10")
        path_frame.pack(fill=tk.X, pady=20)
        
        self.install_path_var = tk.StringVar(value=self.config['install_path'])
        ttk.Entry(path_frame, textvariable=self.install_path_var, width=50).pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(path_frame, text="Browse...", command=self.browse_install_path).pack(side=tk.LEFT)
    
    def browse_install_path(self):
        path = filedialog.askdirectory(title="Select Installation Folder")
        if path:
            self.install_path_var.set(path)
            self.config['install_path'] = path
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 2: Network Configuration
    # ─────────────────────────────────────────────────────────────────
    def create_network_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="🌐 Network Configuration", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        # Host IP
        ip_frame = ttk.LabelFrame(frame, text="Local IP Address", padding="10")
        ip_frame.pack(fill=tk.X, pady=10)
        
        self.host_ip_var = tk.StringVar(value=self.config['host_ip'])
        ip_entry = ttk.Entry(ip_frame, textvariable=self.host_ip_var, width=20)
        ip_entry.pack(side=tk.LEFT, padx=(0, 10))
        
        ttk.Button(ip_frame, text="🔍 Auto-Detect", command=self.detect_ip).pack(side=tk.LEFT)
        
        ttk.Label(ip_frame, text="\nYour PC's local network IP address.\n"
                  "Usually starts with 192.168.x.x or 10.x.x.x\n"
                  "Run 'ipconfig' in Command Prompt to find it manually.",
                  justify=tk.LEFT, foreground='gray').pack(anchor='w', pady=(10, 0))
        
        # ErsatzTV Port
        etv_frame = ttk.LabelFrame(frame, text="ErsatzTV Port", padding="10")
        etv_frame.pack(fill=tk.X, pady=10)
        
        self.ersatztv_port_var = tk.StringVar(value=self.config['ersatztv_port'])
        ttk.Entry(etv_frame, textvariable=self.ersatztv_port_var, width=10).pack(side=tk.LEFT)
        
        ttk.Label(etv_frame, text="  Default is 8409. Only change if you modified ErsatzTV settings.",
                  foreground='gray').pack(side=tk.LEFT)
        
        # Auto-detect IP on page load
        if not self.config['host_ip']:
            self.detect_ip()
    
    def detect_ip(self):
        """Auto-detect the local IP address"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            self.host_ip_var.set(ip)
            self.config['host_ip'] = ip
        except Exception:
            self.host_ip_var.set("192.168.1.100")
            messagebox.showwarning("Auto-Detect Failed", 
                "Could not auto-detect IP. Please enter it manually.")
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 3: Ports Configuration
    # ─────────────────────────────────────────────────────────────────
    def create_ports_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="🔌 Port Configuration", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        ttk.Label(frame, text="Configure the ports for each service.\n"
                  "Default ports are recommended unless you have conflicts.",
                  foreground='gray').pack(anchor='w', pady=(0, 20))
        
        # Port entries
        ports_frame = ttk.Frame(frame)
        ports_frame.pack(fill=tk.X)
        
        self.port_vars = {}
        ports = [
            ('npm_http_port', 'HTTP Port', '80', 'Main web traffic'),
            ('npm_https_port', 'HTTPS Port', '443', 'Secure web traffic'),
            ('npm_admin_port', 'NPM Admin Port', '81', 'Nginx Proxy Manager admin'),
            ('game_server_port', 'Game Server Port', '3000', 'WebSocket for multiplayer'),
            ('epg_server_port', 'EPG Server Port', '3001', 'TV guide data API'),
        ]
        
        for i, (key, label, default, desc) in enumerate(ports):
            row = ttk.Frame(ports_frame)
            row.pack(fill=tk.X, pady=5)
            
            ttk.Label(row, text=f"{label}:", width=18, anchor='e').pack(side=tk.LEFT)
            
            self.port_vars[key] = tk.StringVar(value=self.config.get(key, default))
            ttk.Entry(row, textvariable=self.port_vars[key], width=8).pack(side=tk.LEFT, padx=10)
            
            ttk.Label(row, text=desc, foreground='gray').pack(side=tk.LEFT)
        
        # Test mode info
        test_frame = ttk.LabelFrame(frame, text="💡 Testing Tip", padding="10")
        test_frame.pack(fill=tk.X, pady=20)
        
        ttk.Label(test_frame, text="For side-by-side testing with existing installation:\n"
                  "Use ports like 9080, 9443, 9081, 3100, 3101 to avoid conflicts.",
                  foreground='gray').pack(anchor='w')
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 4: Domain & DuckDNS
    # ─────────────────────────────────────────────────────────────────
    def create_domain_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="🌍 Domain & Dynamic DNS", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        # Domain
        domain_frame = ttk.LabelFrame(frame, text="Domain Name (Optional)", padding="10")
        domain_frame.pack(fill=tk.X, pady=10)
        
        self.domain_var = tk.StringVar(value=self.config['domain'])
        ttk.Entry(domain_frame, textvariable=self.domain_var, width=30).pack(side=tk.LEFT)
        
        ttk.Label(domain_frame, text="  Leave blank for local-only access",
                  foreground='gray').pack(side=tk.LEFT)
        
        # DuckDNS
        duck_frame = ttk.LabelFrame(frame, text="Dynamic DNS (DuckDNS)", padding="10")
        duck_frame.pack(fill=tk.X, pady=10)
        
        self.duckdns_enabled_var = tk.BooleanVar(value=self.config['duckdns_enabled'])
        ttk.Checkbutton(duck_frame, text="Enable DuckDNS", 
                        variable=self.duckdns_enabled_var).pack(anchor='w')
        
        ttk.Label(duck_frame, text="\nDuckDNS automatically updates your domain when your\n"
                  "public IP changes. Free service at duckdns.org",
                  foreground='gray').pack(anchor='w')
        
        sub_frame = ttk.Frame(duck_frame)
        sub_frame.pack(fill=tk.X, pady=(10, 0))
        
        ttk.Label(sub_frame, text="Subdomain:").pack(side=tk.LEFT)
        self.duckdns_subdomain_var = tk.StringVar(value=self.config['duckdns_subdomain'])
        ttk.Entry(sub_frame, textvariable=self.duckdns_subdomain_var, width=20).pack(side=tk.LEFT, padx=5)
        ttk.Label(sub_frame, text=".duckdns.org").pack(side=tk.LEFT)
        
        token_frame = ttk.Frame(duck_frame)
        token_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(token_frame, text="Token:").pack(side=tk.LEFT)
        self.duckdns_token_var = tk.StringVar(value=self.config['duckdns_token'])
        ttk.Entry(token_frame, textvariable=self.duckdns_token_var, width=40, show='*').pack(side=tk.LEFT, padx=5)
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 5: Channels
    # ─────────────────────────────────────────────────────────────────
    def create_channels_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="📺 Channel Configuration", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        ttk.Label(frame, text="Enter channels in format: number:name,number:name\n"
                  "Example: 1000:News,1001:Movies",
                  foreground='gray').pack(anchor='w', pady=(0, 10))
        
        # Web Channels
        web_frame = ttk.LabelFrame(frame, text="Web Channels", padding="10")
        web_frame.pack(fill=tk.X, pady=10)
        
        self.web_channels_var = tk.StringVar(value=self.config['web_channels'])
        ttk.Entry(web_frame, textvariable=self.web_channels_var, width=70).pack(fill=tk.X)
        
        ttk.Label(web_frame, text="Channels displayed on your website",
                  foreground='gray').pack(anchor='w')
        
        # Pi Channels
        pi_frame = ttk.LabelFrame(frame, text="Pi Channels (CRT TV)", padding="10")
        pi_frame.pack(fill=tk.X, pady=10)
        
        self.pi_channels_var = tk.StringVar(value=self.config['pi_channels'])
        ttk.Entry(pi_frame, textvariable=self.pi_channels_var, width=70).pack(fill=tk.X)
        
        ttk.Label(pi_frame, text="4:3 channels for Raspberry Pi CRT setup",
                  foreground='gray').pack(anchor='w')
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 6: Raspberry Pi
    # ─────────────────────────────────────────────────────────────────
    def create_pi_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="🥧 Raspberry Pi Configuration", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        ttk.Label(frame, text="Settings for your CRT TV Raspberry Pi client.\n"
                  "Skip this section if you don't have a Pi setup.",
                  foreground='gray').pack(anchor='w', pady=(0, 20))
        
        config_frame = ttk.Frame(frame)
        config_frame.pack(fill=tk.X)
        
        # Hostname
        row1 = ttk.Frame(config_frame)
        row1.pack(fill=tk.X, pady=5)
        ttk.Label(row1, text="Pi Hostname:", width=15, anchor='e').pack(side=tk.LEFT)
        self.pi_hostname_var = tk.StringVar(value=self.config['pi_hostname'])
        ttk.Entry(row1, textvariable=self.pi_hostname_var, width=20).pack(side=tk.LEFT, padx=10)
        
        # Username
        row2 = ttk.Frame(config_frame)
        row2.pack(fill=tk.X, pady=5)
        ttk.Label(row2, text="Pi Username:", width=15, anchor='e').pack(side=tk.LEFT)
        self.pi_user_var = tk.StringVar(value=self.config['pi_user'])
        ttk.Entry(row2, textvariable=self.pi_user_var, width=20).pack(side=tk.LEFT, padx=10)
        
        # Default Channel
        row3 = ttk.Frame(config_frame)
        row3.pack(fill=tk.X, pady=5)
        ttk.Label(row3, text="Default Channel:", width=15, anchor='e').pack(side=tk.LEFT)
        self.pi_default_channel_var = tk.StringVar(value=self.config['pi_default_channel'])
        ttk.Entry(row3, textvariable=self.pi_default_channel_var, width=10).pack(side=tk.LEFT, padx=10)
        ttk.Label(row3, text="Channel to play on Pi startup", foreground='gray').pack(side=tk.LEFT)
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 7: Backup
    # ─────────────────────────────────────────────────────────────────
    def create_backup_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="💾 Backup Configuration", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        # Enable backups
        self.backup_enabled_var = tk.BooleanVar(value=self.config['backup_enabled'])
        ttk.Checkbutton(frame, text="Enable automatic daily backups", 
                        variable=self.backup_enabled_var).pack(anchor='w')
        
        ttk.Label(frame, text="\nBackups player data (items.json, leaderboard.json)\n"
                  "daily at 3:00 AM. Keeps last 30 days.",
                  foreground='gray').pack(anchor='w', pady=(0, 20))
        
        # Backup path
        path_frame = ttk.LabelFrame(frame, text="Backup Location", padding="10")
        path_frame.pack(fill=tk.X, pady=10)
        
        default_backup = os.path.join(self.config['install_path'], 'backups')
        self.backup_path_var = tk.StringVar(value=self.config['backup_path'] or default_backup)
        ttk.Entry(path_frame, textvariable=self.backup_path_var, width=50).pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(path_frame, text="Browse...", command=self.browse_backup_path).pack(side=tk.LEFT)
        
        # What gets backed up
        info_frame = ttk.LabelFrame(frame, text="What Gets Backed Up", padding="10")
        info_frame.pack(fill=tk.X, pady=10)
        
        ttk.Label(info_frame, text="• items.json - Player accounts, inventories, PIN hashes\n"
                  "• leaderboard.json - Game scores and rankings\n\n"
                  "Note: ErsatzTV database should be backed up separately\n"
                  "from %AppData%\\ersatztv\\",
                  justify=tk.LEFT).pack(anchor='w')
    
    def browse_backup_path(self):
        path = filedialog.askdirectory(title="Select Backup Folder")
        if path:
            self.backup_path_var.set(path)
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 8: Summary
    # ─────────────────────────────────────────────────────────────────
    def create_summary_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="📋 Configuration Summary", 
                  font=('Helvetica', 16, 'bold')).pack(pady=(0, 20))
        
        # Collect all values
        self.collect_config()
        
        # Create summary text
        summary = f"""Network:
  Host IP: {self.config['host_ip']}
  Domain: {self.config['domain'] or '(local only)'}

Ports:
  HTTP: {self.config['npm_http_port']}  |  HTTPS: {self.config['npm_https_port']}
  Admin: {self.config['npm_admin_port']}  |  Game: {self.config['game_server_port']}  |  EPG: {self.config['epg_server_port']}

Dynamic DNS:
  DuckDNS: {'Enabled' if self.config['duckdns_enabled'] else 'Disabled'}

Raspberry Pi:
  Hostname: {self.config['pi_hostname']}  |  User: {self.config['pi_user']}
  Default Channel: {self.config['pi_default_channel']}

Backups:
  Enabled: {'Yes' if self.config['backup_enabled'] else 'No'}
  Path: {self.config['backup_path']}

Install Path: {self.config['install_path']}"""
        
        text_widget = tk.Text(frame, height=18, width=60, font=('Consolas', 10))
        text_widget.insert('1.0', summary)
        text_widget.config(state=tk.DISABLED)
        text_widget.pack(pady=10)
        
        ttk.Label(frame, text="Click 'Deploy' to generate configuration files and start services.",
                  foreground='gray').pack()
    
    def collect_config(self):
        """Collect all config values from UI"""
        try:
            self.config['install_path'] = self.install_path_var.get()
            self.config['host_ip'] = self.host_ip_var.get()
            self.config['ersatztv_port'] = self.ersatztv_port_var.get()
            
            for key, var in self.port_vars.items():
                self.config[key] = var.get()
            
            self.config['domain'] = self.domain_var.get()
            self.config['duckdns_enabled'] = self.duckdns_enabled_var.get()
            self.config['duckdns_subdomain'] = self.duckdns_subdomain_var.get()
            self.config['duckdns_token'] = self.duckdns_token_var.get()
            self.config['web_channels'] = self.web_channels_var.get()
            self.config['pi_channels'] = self.pi_channels_var.get()
            self.config['pi_hostname'] = self.pi_hostname_var.get()
            self.config['pi_user'] = self.pi_user_var.get()
            self.config['pi_default_channel'] = self.pi_default_channel_var.get()
            self.config['backup_enabled'] = self.backup_enabled_var.get()
            self.config['backup_path'] = self.backup_path_var.get()
        except:
            pass  # Some vars may not exist yet
    
    # ─────────────────────────────────────────────────────────────────
    # PAGE 9: Complete
    # ─────────────────────────────────────────────────────────────────
    def create_complete_page(self):
        frame = ttk.Frame(self.page_frame, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="🎉 Setup Complete!", 
                  font=('Helvetica', 18, 'bold')).pack(pady=(0, 20))
        
        complete_text = f"""Your Ylem installation is ready!

Files Generated:
  ✓ .env (configuration)
  ✓ docker-compose.yml (updated)
  ✓ Nginx config template
  ✓ Pi configuration files

Access Your Site:
  • Local: http://{self.config['host_ip']}:{self.config['npm_http_port']}
  • Admin: http://{self.config['host_ip']}:{self.config['npm_admin_port']}

Next Steps:
  1. Open NPM Admin and configure your proxy host
  2. Paste the nginx config from setup/templates/
  3. Set up SSL certificate (if using a domain)
  4. Configure your router port forwarding

The generated .env file is at:
  {os.path.join(self.config['install_path'], '.env')}"""
        
        text_widget = tk.Text(frame, height=20, width=60, font=('Consolas', 10))
        text_widget.insert('1.0', complete_text)
        text_widget.config(state=tk.DISABLED)
        text_widget.pack(pady=10)
        
        btn_frame = ttk.Frame(frame)
        btn_frame.pack(pady=10)
        
        ttk.Button(btn_frame, text="📂 Open Install Folder", 
                   command=lambda: os.startfile(self.config['install_path'])).pack(side=tk.LEFT, padx=5)
    
    # ─────────────────────────────────────────────────────────────────
    # DEPLOYMENT
    # ─────────────────────────────────────────────────────────────────
    def deploy(self):
        """Generate all configuration files"""
        self.collect_config()
        
        try:
            install_path = Path(self.config['install_path'])
            install_path.mkdir(parents=True, exist_ok=True)
            
            # Generate .env file
            self.generate_env_file(install_path)
            
            # Generate nginx config
            self.generate_nginx_config(install_path)
            
            # Generate Pi files
            self.generate_pi_files(install_path)
            
            # Copy source files if they exist in same directory
            self.copy_source_files(install_path)
            
            messagebox.showinfo("Success", "Configuration files generated successfully!")
            self.show_page(self.current_page + 1)
            
        except Exception as e:
            messagebox.showerror("Error", f"Deployment failed:\n{str(e)}")
    
    def generate_env_file(self, install_path):
        """Generate the .env file"""
        env_content = f"""# ===========================================
# YLEM CONFIGURATION
# Generated by Ylem Setup Wizard
# ===========================================

# Network
HOST_IP={self.config['host_ip']}
DOMAIN={self.config['domain']}

# Ports
NPM_HTTP_PORT={self.config['npm_http_port']}
NPM_HTTPS_PORT={self.config['npm_https_port']}
NPM_ADMIN_PORT={self.config['npm_admin_port']}
GAME_SERVER_PORT={self.config['game_server_port']}
EPG_SERVER_PORT={self.config['epg_server_port']}
ERSATZTV_PORT={self.config['ersatztv_port']}

# Dynamic DNS
DUCKDNS_ENABLED={str(self.config['duckdns_enabled']).lower()}
DUCKDNS_SUBDOMAIN={self.config['duckdns_subdomain']}
DUCKDNS_TOKEN={self.config['duckdns_token']}

# Channels
WEB_CHANNELS={self.config['web_channels']}
PI_CHANNELS={self.config['pi_channels']}

# Raspberry Pi
PI_HOSTNAME={self.config['pi_hostname']}
PI_USER={self.config['pi_user']}
PI_DEFAULT_CHANNEL={self.config['pi_default_channel']}

# Backups
BACKUP_ENABLED={str(self.config['backup_enabled']).lower()}
BACKUP_PATH={self.config['backup_path']}
BACKUP_TIME=03:00
BACKUP_RETENTION_DAYS=30

# Version Pinning
NPM_IMAGE_VERSION=latest
NODE_IMAGE_VERSION=20-alpine
"""
        env_path = install_path / '.env'
        env_path.write_text(env_content)
    
    def generate_nginx_config(self, install_path):
        """Generate nginx advanced config"""
        templates_dir = install_path / 'setup' / 'templates'
        templates_dir.mkdir(parents=True, exist_ok=True)
        
        nginx_config = f"""# ===========================================
# YLEM - Nginx Proxy Manager Advanced Config
# Generated by Setup Wizard
# Paste this into NPM → Hosts → Edit → Advanced
# ===========================================

# Serve index.html for root
location = / {{
    root /data;
    try_files /index.html =404;
}}

# Serve watch.html for /chXXXX URLs
location ~ ^/ch\\d+$ {{
    root /data;
    try_files /watch.html =404;
}}

# V2 Game Hub files
location /v2/ {{
    root /data;
    try_files $uri $uri/ =404;
}}

# Games hub (clean URL)
location = /games {{
    root /data;
    try_files /v2/games.html =404;
}}

# EPG Guide (clean URL)
location = /guide {{
    root /data;
    try_files /v2/guide.html =404;
}}

# IPTV proxy (ErsatzTV streams)
location /iptv/ {{
    proxy_pass http://{self.config['host_ip']}:{self.config['ersatztv_port']}/iptv/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
}}

# WebSocket proxy for multiplayer
location /ws/ {{
    proxy_pass http://{self.config['host_ip']}:{self.config['game_server_port']}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;
}}

# EPG API proxy
location ^~ /api/epg {{
    proxy_pass http://{self.config['host_ip']}:{self.config['epg_server_port']};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}}

# Serve static files
location ~ \\.(html|css|js|ico|png|jpg|svg|txt|json)$ {{
    root /data;
    try_files $uri =404;
}}
"""
        config_path = templates_dir / 'nginx-advanced.conf'
        config_path.write_text(nginx_config)
    
    def generate_pi_files(self, install_path):
        """Generate Raspberry Pi configuration files"""
        pi_dir = install_path / 'pi-client'
        pi_dir.mkdir(parents=True, exist_ok=True)
        
        # Simple stream startup script
        startup_script = f"""#!/bin/bash
# Ylem CRT TV Stream Startup
# Generated by Setup Wizard

HOST_IP="{self.config['host_ip']}"
DEFAULT_CHANNEL="{self.config['pi_default_channel']}"

# Wait for network
sleep 5

# Start MPV with the default channel
mpv --no-terminal --fullscreen \\
    --vo=gpu --hwdec=auto \\
    "http://$HOST_IP:{self.config['ersatztv_port']}/iptv/channel/$DEFAULT_CHANNEL.m3u8"
"""
        (pi_dir / 'stream_startup.sh').write_text(startup_script)
    
    def copy_source_files(self, install_path):
        """Copy source files from wizard directory to install path"""
        # Get the directory where setup.py is located
        wizard_dir = Path(__file__).parent.parent
        
        # Directories to copy
        dirs_to_copy = ['data', 'web', 'epg-server', 'game-server', 'diagnostics', 'scripts']
        
        for dir_name in dirs_to_copy:
            src = wizard_dir / dir_name
            dst = install_path / dir_name
            if src.exists() and not dst.exists():
                shutil.copytree(src, dst, dirs_exist_ok=True)
        
        # Copy docker-compose.yml
        compose_src = wizard_dir / 'docker-compose.yml'
        if compose_src.exists():
            shutil.copy(compose_src, install_path / 'docker-compose.yml')


def main():
    root = tk.Tk()
    app = YlemSetupWizard(root)
    root.mainloop()


if __name__ == '__main__':
    main()
