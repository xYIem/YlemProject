#!/usr/bin/env python3
"""
Ylem Installer
Standalone installer that downloads components from GitHub releases
and configures the Ylem TV & Game Hub.

Build with: pyinstaller --onefile --windowed --icon=ylem.ico ylem_installer.py
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import socket
import subprocess
import os
import sys
import json
import zipfile
import tempfile
import threading
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

GITHUB_USER = "xYIem"
GITHUB_REPO = "YlemProject"
GITHUB_RELEASE_URL = f"https://api.github.com/repos/{GITHUB_USER}/{GITHUB_REPO}/releases/latest"
GITHUB_RAW_URL = f"https://raw.githubusercontent.com/{GITHUB_USER}/{GITHUB_REPO}/main"

VERSION = "1.0.0"

# Component definitions
COMPONENTS = {
    'core': {
        'name': 'Core (Required)',
        'description': 'Nginx Proxy Manager, base configuration',
        'required': True,
        'files': [
            'docker-compose.yml',
            '.env.example',
            'data/index.html',
            'data/watch.html',
            'data/Images/',
        ]
    },
    'tv': {
        'name': 'TV Hub',
        'description': 'ErsatzTV integration, channel streaming',
        'required': False,
        'files': [
            'epg-server/',
        ]
    },
    'epg': {
        'name': 'EPG Guide',
        'description': 'Electronic Program Guide with now/next info',
        'required': False,
        'depends': ['tv'],
        'files': [
            'web/v2/guide.html',
        ]
    },
    'games': {
        'name': 'Game Hub',
        'description': 'Multiplayer games (Boggle, Scrabble)',
        'required': False,
        'files': [
            'game-server/',
            'web/v2/games.html',
            'web/v2/games/',
            'web/v2/css/',
            'web/v2/js/',
        ]
    },
    'diagnostics': {
        'name': 'Diagnostics Dashboard',
        'description': 'System monitoring and Pi status',
        'required': False,
        'files': [
            'diagnostics/',
        ]
    },
    'pi_client': {
        'name': 'Pi CRT Client',
        'description': 'Raspberry Pi configuration for CRT TV',
        'required': False,
        'files': [
            'pi-client/',
        ]
    },
}


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

class YlemInstaller:
    def __init__(self, root):
        self.root = root
        self.root.title(f"Ylem Installer v{VERSION}")
        self.root.geometry("750x650")
        self.root.resizable(True, True)
        self.root.minsize(700, 600)
        
        # Try to set icon if available
        try:
            if getattr(sys, 'frozen', False):
                # Running as compiled exe
                base_path = sys._MEIPASS
            else:
                base_path = os.path.dirname(__file__)
            icon_path = os.path.join(base_path, 'ylem.ico')
            if os.path.exists(icon_path):
                self.root.iconbitmap(icon_path)
        except:
            pass
        
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
            'web_channels': '',
            'pi_channels': '',
            'pi_hostname': 'YlemPi',
            'pi_user': 'ylem',
            'pi_default_channel': '',
            'backup_enabled': True,
            'backup_path': '',
            'install_path': 'C:\\Ylem',
        }
        
        # Selected components
        self.selected_components = {
            'core': tk.BooleanVar(value=True),
            'tv': tk.BooleanVar(value=True),
            'epg': tk.BooleanVar(value=True),
            'games': tk.BooleanVar(value=False),
            'diagnostics': tk.BooleanVar(value=False),
            'pi_client': tk.BooleanVar(value=False),
        }
        
        # Track current page
        self.current_page = 0
        self.pages = []
        
        # Style
        style = ttk.Style()
        style.configure('Header.TLabel', font=('Segoe UI', 16, 'bold'))
        style.configure('SubHeader.TLabel', font=('Segoe UI', 10), foreground='gray')
        
        # Create main container
        self.container = ttk.Frame(root, padding="15")
        self.container.pack(fill=tk.BOTH, expand=True)
        
        # Header with logo placeholder
        header_frame = ttk.Frame(self.container)
        header_frame.pack(fill=tk.X, pady=(0, 10))
        
        ttk.Label(header_frame, text="📺 YLEM", font=('Segoe UI', 24, 'bold')).pack(side=tk.LEFT)
        ttk.Label(header_frame, text=f"v{VERSION}", font=('Segoe UI', 10), 
                  foreground='gray').pack(side=tk.LEFT, padx=(10, 0), pady=(12, 0))
        
        # Progress indicator
        self.progress_frame = ttk.Frame(self.container)
        self.progress_frame.pack(fill=tk.X, pady=(0, 15))
        
        self.progress_labels = []
        steps = ['Components', 'Network', 'Ports', 'Domain', 'Channels', 'Summary', 'Install']
        for i, step in enumerate(steps):
            lbl = ttk.Label(self.progress_frame, text=step, font=('Segoe UI', 8))
            lbl.pack(side=tk.LEFT, expand=True)
            self.progress_labels.append(lbl)
        
        # Separator
        ttk.Separator(self.container, orient='horizontal').pack(fill=tk.X, pady=(0, 15))
        
        # Page container
        self.page_frame = ttk.Frame(self.container)
        self.page_frame.pack(fill=tk.BOTH, expand=True)
        
        # Navigation buttons
        self.nav_frame = ttk.Frame(self.container)
        self.nav_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=(15, 0))
        
        self.back_btn = ttk.Button(self.nav_frame, text="← Back", command=self.prev_page)
        self.back_btn.pack(side=tk.LEFT)
        
        self.next_btn = ttk.Button(self.nav_frame, text="Next →", command=self.next_page)
        self.next_btn.pack(side=tk.RIGHT)
        
        # Build pages
        self.build_pages()
        self.show_page(0)
    
    def build_pages(self):
        """Define all wizard pages"""
        self.pages = [
            self.create_components_page,      # 0
            self.create_network_page,         # 1
            self.create_ports_page,           # 2
            self.create_domain_page,          # 3
            self.create_channels_page,        # 4
            self.create_summary_page,         # 5
            self.create_install_page,         # 6
        ]
    
    def update_progress(self, index):
        """Update progress indicator"""
        for i, lbl in enumerate(self.progress_labels):
            if i < index:
                lbl.configure(foreground='green')
            elif i == index:
                lbl.configure(foreground='blue', font=('Segoe UI', 8, 'bold'))
            else:
                lbl.configure(foreground='gray', font=('Segoe UI', 8))
    
    def show_page(self, index):
        """Display a specific page"""
        # Clear current page
        for widget in self.page_frame.winfo_children():
            widget.destroy()
        
        # Update navigation
        self.back_btn.config(state=tk.NORMAL if index > 0 else tk.DISABLED)
        
        if index == len(self.pages) - 2:  # Summary page
            self.next_btn.config(text="🚀 Install")
        elif index == len(self.pages) - 1:  # Install page
            self.next_btn.config(text="Close", command=self.root.quit)
            self.back_btn.config(state=tk.DISABLED)
        else:
            self.next_btn.config(text="Next →", command=self.next_page)
        
        self.current_page = index
        self.update_progress(index)
        self.pages[index]()
    
    def next_page(self):
        """Go to next page"""
        # Validate current page
        if not self.validate_page():
            return
            
        if self.current_page == len(self.pages) - 2:  # Summary -> Install
            self.show_page(self.current_page + 1)
            self.start_installation()
        elif self.current_page < len(self.pages) - 1:
            self.show_page(self.current_page + 1)
    
    def prev_page(self):
        """Go to previous page"""
        if self.current_page > 0:
            self.show_page(self.current_page - 1)
    
    def validate_page(self):
        """Validate current page before proceeding"""
        if self.current_page == 1:  # Network page
            if not self.host_ip_var.get():
                messagebox.showerror("Error", "Please enter your local IP address")
                return False
            self.config['host_ip'] = self.host_ip_var.get()
            self.config['ersatztv_port'] = self.ersatztv_port_var.get()
        elif self.current_page == 2:  # Ports page
            for key, var in self.port_vars.items():
                self.config[key] = var.get()
        elif self.current_page == 3:  # Domain page
            self.config['domain'] = self.domain_var.get()
            self.config['duckdns_enabled'] = self.duckdns_enabled_var.get()
            self.config['duckdns_subdomain'] = self.duckdns_subdomain_var.get()
            self.config['duckdns_token'] = self.duckdns_token_var.get()
        elif self.current_page == 4:  # Channels page
            self.config['web_channels'] = self.web_channels_var.get()
            self.config['pi_channels'] = self.pi_channels_var.get()
            self.config['pi_hostname'] = self.pi_hostname_var.get()
            self.config['pi_user'] = self.pi_user_var.get()
            self.config['pi_default_channel'] = self.pi_default_channel_var.get()
        return True

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 1: Component Selection
    # ═══════════════════════════════════════════════════════════════════════════
    def create_components_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Select Components", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Choose which parts of Ylem to install", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 15))
        
        # Component checkboxes in a compact frame
        components_frame = ttk.LabelFrame(frame, text="Components", padding="10")
        components_frame.pack(fill=tk.X, pady=(0, 10))
        
        for key, comp in COMPONENTS.items():
            comp_frame = ttk.Frame(components_frame)
            comp_frame.pack(fill=tk.X, pady=2)
            
            cb = ttk.Checkbutton(
                comp_frame, 
                text=comp['name'],
                variable=self.selected_components[key],
                state=tk.DISABLED if comp.get('required') else tk.NORMAL
            )
            cb.pack(side=tk.LEFT)
            
            ttk.Label(comp_frame, text=f"  - {comp['description']}", 
                      foreground='gray').pack(side=tk.LEFT)
        
        # Install path
        path_frame = ttk.LabelFrame(frame, text="Installation Path", padding="10")
        path_frame.pack(fill=tk.X, pady=(10, 10))
        
        self.install_path_var = tk.StringVar(value=self.config['install_path'])
        ttk.Entry(path_frame, textvariable=self.install_path_var, width=50).pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(path_frame, text="Browse...", command=self.browse_install_path).pack(side=tk.LEFT)
        
        # Prerequisites with clickable links
        prereq_frame = ttk.LabelFrame(frame, text="Prerequisites (click to download)", padding="10")
        prereq_frame.pack(fill=tk.X, pady=(10, 0))
        
        # Docker Desktop
        docker_frame = ttk.Frame(prereq_frame)
        docker_frame.pack(fill=tk.X, pady=2)
        ttk.Label(docker_frame, text="• Docker Desktop", width=20, anchor='w').pack(side=tk.LEFT)
        docker_link = ttk.Label(docker_frame, text="Download", foreground='blue', cursor='hand2')
        docker_link.pack(side=tk.LEFT)
        docker_link.bind('<Button-1>', lambda e: self.open_url('https://www.docker.com/products/docker-desktop/'))
        
        # ErsatzTV
        etv_frame = ttk.Frame(prereq_frame)
        etv_frame.pack(fill=tk.X, pady=2)
        ttk.Label(etv_frame, text="• ErsatzTV", width=20, anchor='w').pack(side=tk.LEFT)
        etv_link = ttk.Label(etv_frame, text="Download", foreground='blue', cursor='hand2')
        etv_link.pack(side=tk.LEFT)
        etv_link.bind('<Button-1>', lambda e: self.open_url('https://github.com/ErsatzTV/ErsatzTV/releases'))
        
        # Node.js (optional, for local dev)
        node_frame = ttk.Frame(prereq_frame)
        node_frame.pack(fill=tk.X, pady=2)
        ttk.Label(node_frame, text="• Node.js (optional)", width=20, anchor='w').pack(side=tk.LEFT)
        node_link = ttk.Label(node_frame, text="Download", foreground='blue', cursor='hand2')
        node_link.pack(side=tk.LEFT)
        node_link.bind('<Button-1>', lambda e: self.open_url('https://nodejs.org/en/download/'))
    
    def open_url(self, url):
        """Open URL in default browser"""
        import webbrowser
        webbrowser.open(url)
    
    def browse_install_path(self):
        path = filedialog.askdirectory(title="Select Installation Folder")
        if path:
            self.install_path_var.set(path)
            self.config['install_path'] = path

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 2: Network Configuration
    # ═══════════════════════════════════════════════════════════════════════════
    def create_network_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Network Configuration", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Configure your network settings", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 20))
        
        # Host IP
        ip_frame = ttk.LabelFrame(frame, text="Local IP Address", padding="10")
        ip_frame.pack(fill=tk.X, pady=10)
        
        ip_row = ttk.Frame(ip_frame)
        ip_row.pack(fill=tk.X)
        
        self.host_ip_var = tk.StringVar(value=self.config['host_ip'])
        ttk.Entry(ip_row, textvariable=self.host_ip_var, width=20, font=('Consolas', 11)).pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(ip_row, text="🔍 Auto-Detect", command=self.detect_ip).pack(side=tk.LEFT)
        
        ttk.Label(ip_frame, text="Your PC's IP on the local network (usually 192.168.x.x)\n"
                  "Run 'ipconfig' in Command Prompt to find it manually.",
                  foreground='gray').pack(anchor='w', pady=(10, 0))
        
        # ErsatzTV Port
        if self.selected_components['tv'].get():
            etv_frame = ttk.LabelFrame(frame, text="ErsatzTV Port", padding="10")
            etv_frame.pack(fill=tk.X, pady=10)
            
            self.ersatztv_port_var = tk.StringVar(value=self.config['ersatztv_port'])
            ttk.Entry(etv_frame, textvariable=self.ersatztv_port_var, width=10, 
                      font=('Consolas', 11)).pack(side=tk.LEFT)
            ttk.Label(etv_frame, text="  Default is 8409", foreground='gray').pack(side=tk.LEFT)
        else:
            self.ersatztv_port_var = tk.StringVar(value='8409')
        
        # Auto-detect on page load
        if not self.config['host_ip']:
            self.detect_ip()
    
    def detect_ip(self):
        """Auto-detect local IP"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            self.host_ip_var.set(ip)
            self.config['host_ip'] = ip
        except Exception:
            messagebox.showwarning("Auto-Detect Failed", 
                "Could not detect IP. Please enter manually.")

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 3: Ports Configuration
    # ═══════════════════════════════════════════════════════════════════════════
    def create_ports_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Port Configuration", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Configure service ports (defaults recommended)", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 20))
        
        self.port_vars = {}
        
        ports = [
            ('npm_http_port', 'HTTP Port', '80', 'Web traffic'),
            ('npm_https_port', 'HTTPS Port', '443', 'Secure traffic'),
            ('npm_admin_port', 'Admin Port', '81', 'NPM admin panel'),
        ]
        
        # Add conditional ports
        if self.selected_components['games'].get():
            ports.append(('game_server_port', 'Game Server', '3000', 'Multiplayer WebSocket'))
        
        if self.selected_components['tv'].get():
            ports.append(('epg_server_port', 'EPG Server', '3001', 'TV guide API'))
        
        ports_frame = ttk.Frame(frame)
        ports_frame.pack(fill=tk.X)
        
        for key, label, default, desc in ports:
            row = ttk.Frame(ports_frame)
            row.pack(fill=tk.X, pady=8)
            
            ttk.Label(row, text=f"{label}:", width=15, anchor='e').pack(side=tk.LEFT)
            
            self.port_vars[key] = tk.StringVar(value=self.config.get(key, default))
            ttk.Entry(row, textvariable=self.port_vars[key], width=8, 
                      font=('Consolas', 11)).pack(side=tk.LEFT, padx=10)
            ttk.Label(row, text=desc, foreground='gray').pack(side=tk.LEFT)
        
        # Tip box
        tip_frame = ttk.LabelFrame(frame, text="💡 Tip", padding="10")
        tip_frame.pack(fill=tk.X, pady=20)
        ttk.Label(tip_frame, text="For testing alongside an existing install, use alternate ports:\n"
                  "9080, 9443, 9081, 3100, 3101", foreground='gray').pack(anchor='w')

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 4: Domain & DNS
    # ═══════════════════════════════════════════════════════════════════════════
    def create_domain_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Domain & Dynamic DNS", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Optional - for remote access", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 20))
        
        # Domain
        domain_frame = ttk.LabelFrame(frame, text="Domain Name", padding="10")
        domain_frame.pack(fill=tk.X, pady=10)
        
        self.domain_var = tk.StringVar(value=self.config['domain'])
        ttk.Entry(domain_frame, textvariable=self.domain_var, width=30, 
                  font=('Consolas', 11)).pack(side=tk.LEFT)
        ttk.Label(domain_frame, text="  Leave blank for local-only", foreground='gray').pack(side=tk.LEFT)
        
        # DuckDNS
        duck_frame = ttk.LabelFrame(frame, text="Dynamic DNS (DuckDNS)", padding="10")
        duck_frame.pack(fill=tk.X, pady=10)
        
        self.duckdns_enabled_var = tk.BooleanVar(value=self.config['duckdns_enabled'])
        ttk.Checkbutton(duck_frame, text="Enable DuckDNS auto-update", 
                        variable=self.duckdns_enabled_var).pack(anchor='w')
        
        ttk.Label(duck_frame, text="Free service that updates your domain when IP changes\n"
                  "Sign up at duckdns.org", foreground='gray').pack(anchor='w', pady=(5, 10))
        
        sub_row = ttk.Frame(duck_frame)
        sub_row.pack(fill=tk.X, pady=5)
        ttk.Label(sub_row, text="Subdomain:", width=10).pack(side=tk.LEFT)
        self.duckdns_subdomain_var = tk.StringVar(value=self.config['duckdns_subdomain'])
        ttk.Entry(sub_row, textvariable=self.duckdns_subdomain_var, width=20).pack(side=tk.LEFT)
        ttk.Label(sub_row, text=".duckdns.org").pack(side=tk.LEFT)
        
        token_row = ttk.Frame(duck_frame)
        token_row.pack(fill=tk.X, pady=5)
        ttk.Label(token_row, text="Token:", width=10).pack(side=tk.LEFT)
        self.duckdns_token_var = tk.StringVar(value=self.config['duckdns_token'])
        ttk.Entry(token_row, textvariable=self.duckdns_token_var, width=45, show='•').pack(side=tk.LEFT)

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 5: Channels & Pi Config
    # ═══════════════════════════════════════════════════════════════════════════
    def create_channels_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Channel Configuration", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="How channels are detected", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 20))
        
        # Initialize variables with defaults
        self.web_channels_var = tk.StringVar()
        self.pi_channels_var = tk.StringVar()
        self.pi_hostname_var = tk.StringVar(value='YlemPi')
        self.pi_user_var = tk.StringVar(value='ylem')
        self.pi_default_channel_var = tk.StringVar()
        
        if self.selected_components['tv'].get():
            # Automatic channel detection info
            auto_frame = ttk.LabelFrame(frame, text="✓ Automatic Channel Detection", padding="15")
            auto_frame.pack(fill=tk.X, pady=10)
            
            ttk.Label(auto_frame, text="Channels are automatically loaded from ErsatzTV!", 
                      font=('Segoe UI', 10, 'bold')).pack(anchor='w')
            
            ttk.Label(auto_frame, text="\nThe EPG server will fetch channel data from:\n"
                      f"  • http://[HOST_IP]:{self.config['ersatztv_port']}/iptv/xmltv.xml\n"
                      f"  • http://[HOST_IP]:{self.config['ersatztv_port']}/iptv/channels.m3u\n\n"
                      "All channels from ErsatzTV will appear in the guide automatically.\n"
                      "Channel logos are downloaded and cached locally.",
                      foreground='gray', justify=tk.LEFT).pack(anchor='w')
        
        if self.selected_components['pi_client'].get():
            # Pi CRT info
            pi_frame = ttk.LabelFrame(frame, text="🥧 Raspberry Pi CRT", padding="15")
            pi_frame.pack(fill=tk.X, pady=10)
            
            ttk.Label(pi_frame, text="Pi configuration will be set up separately.\n\n"
                      "The Pi client will filter for channels starting with 'CRT'\n"
                      "in their name from ErsatzTV.",
                      foreground='gray', justify=tk.LEFT).pack(anchor='w')
        
        if not self.selected_components['tv'].get() and not self.selected_components['pi_client'].get():
            ttk.Label(frame, text="No TV or Pi components selected.\n\n"
                      "Click Next to continue.",
                      foreground='gray').pack(anchor='w', pady=20)

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 6: Summary
    # ═══════════════════════════════════════════════════════════════════════════
    def create_summary_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Installation Summary", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Review your configuration", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 20))
        
        # Collect final config
        self.config['install_path'] = self.install_path_var.get()
        
        # Components list
        components_str = ', '.join([
            COMPONENTS[k]['name'] for k, v in self.selected_components.items() 
            if v.get()
        ])
        
        summary = f"""Components: {components_str}

Install Path: {self.config['install_path']}

Network:
  Host IP: {self.config['host_ip']}
  Domain: {self.config['domain'] or '(local only)'}

Ports:
  HTTP: {self.config['npm_http_port']}  HTTPS: {self.config['npm_https_port']}  Admin: {self.config['npm_admin_port']}"""
        
        if self.selected_components['games'].get():
            summary += f"\n  Game Server: {self.config['game_server_port']}"
        if self.selected_components['tv'].get():
            summary += f"\n  EPG Server: {self.config['epg_server_port']}"
        
        if self.config['duckdns_enabled']:
            summary += f"\n\nDuckDNS: {self.config['duckdns_subdomain']}.duckdns.org"
        
        if self.config['web_channels']:
            summary += f"\n\nWeb Channels: {self.config['web_channels'][:50]}..."
        
        text = tk.Text(frame, height=16, width=70, font=('Consolas', 10))
        text.insert('1.0', summary)
        text.config(state=tk.DISABLED)
        text.pack(pady=10)
        
        ttk.Label(frame, text="Click 'Install' to download and configure Ylem",
                  foreground='blue').pack()

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 7: Installation Progress
    # ═══════════════════════════════════════════════════════════════════════════
    def create_install_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Installing Ylem", style='Header.TLabel').pack(anchor='w')
        
        # Progress bar
        self.install_progress = ttk.Progressbar(frame, mode='determinate', length=500)
        self.install_progress.pack(pady=20)
        
        # Status label
        self.status_var = tk.StringVar(value="Preparing...")
        ttk.Label(frame, textvariable=self.status_var, font=('Segoe UI', 10)).pack()
        
        # Log area
        self.log_text = tk.Text(frame, height=15, width=70, font=('Consolas', 9))
        self.log_text.pack(pady=20)
        
        scrollbar = ttk.Scrollbar(frame, command=self.log_text.yview)
        self.log_text.config(yscrollcommand=scrollbar.set)
    
    def log(self, message):
        """Add message to log"""
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)
        self.root.update()
    
    def start_installation(self):
        """Begin the installation process in a thread"""
        thread = threading.Thread(target=self.run_installation)
        thread.start()
    
    def run_installation(self):
        """Main installation logic"""
        try:
            install_path = Path(self.config['install_path'])
            total_steps = 6
            step = 0
            
            # Step 1: Create directories
            step += 1
            self.install_progress['value'] = (step / total_steps) * 100
            self.status_var.set("Creating directories...")
            self.log("📁 Creating installation directories...")
            
            dirs = ['data', 'data/Images', 'setup/templates', 'scripts']
            if self.selected_components['games'].get():
                dirs.extend(['game-server', 'web/v2/css', 'web/v2/js', 'web/v2/games'])
            if self.selected_components['tv'].get():
                dirs.append('epg-server')
            if self.selected_components['diagnostics'].get():
                dirs.extend(['diagnostics', 'diagnostics/static'])
            if self.selected_components['pi_client'].get():
                dirs.extend(['pi-client', 'pi-client/boot', 'pi-client/autostart'])
            
            for d in dirs:
                (install_path / d).mkdir(parents=True, exist_ok=True)
                self.log(f"  ✓ {d}/")
            
            # Step 2: Download files from GitHub
            step += 1
            self.install_progress['value'] = (step / total_steps) * 100
            self.status_var.set("Downloading from GitHub...")
            self.log("\n📥 Downloading files from GitHub...")
            
            self.download_github_files(install_path)
            
            # Step 3: Generate .env file
            step += 1
            self.install_progress['value'] = (step / total_steps) * 100
            self.status_var.set("Generating configuration...")
            self.log("\n⚙️ Generating .env file...")
            
            self.generate_env_file(install_path)
            self.log("  ✓ .env created")
            
            # Step 4: Generate nginx config
            step += 1
            self.install_progress['value'] = (step / total_steps) * 100
            self.status_var.set("Generating nginx config...")
            
            self.generate_nginx_config(install_path)
            self.log("  ✓ nginx-advanced.conf created")
            
            # Step 5: Generate docker-compose
            step += 1
            self.install_progress['value'] = (step / total_steps) * 100
            self.status_var.set("Generating docker-compose...")
            
            self.generate_docker_compose(install_path)
            self.log("  ✓ docker-compose.yml created")
            
            # Step 6: Generate scripts
            step += 1
            self.install_progress['value'] = (step / total_steps) * 100
            self.status_var.set("Generating scripts...")
            
            self.generate_scripts(install_path)
            self.log("  ✓ Helper scripts created")
            
            # Complete
            self.install_progress['value'] = 100
            self.status_var.set("Installation complete!")
            
            self.log("\n" + "="*50)
            self.log("🎉 INSTALLATION COMPLETE!")
            self.log("="*50)
            self.log(f"\nInstalled to: {install_path}")
            self.log(f"\nNext steps:")
            self.log(f"  1. cd {install_path}")
            self.log(f"  2. docker-compose up -d")
            self.log(f"  3. Open http://{self.config['host_ip']}:{self.config['npm_admin_port']}")
            self.log(f"  4. Configure proxy host with nginx-advanced.conf")
            
            # Update button
            self.next_btn.config(text="Open Folder", 
                                command=lambda: os.startfile(str(install_path)))
            
        except Exception as e:
            self.log(f"\n❌ ERROR: {str(e)}")
            self.status_var.set("Installation failed!")
            messagebox.showerror("Error", f"Installation failed:\n{str(e)}")
    
    def download_github_files(self, install_path):
        """Download files from GitHub"""
        # For now, generate files locally since repo isn't set up yet
        # In production, this would fetch from GitHub releases
        
        self.log("  (Files will be fetched from GitHub releases)")
        self.log("  For now, generating template files locally...")
        
        # Create placeholder index.html
        index_html = '''<!DOCTYPE html>
<html>
<head>
    <title>Ylem TV</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            background: #1a1a2e; 
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .container { text-align: center; }
        h1 { font-size: 3em; margin-bottom: 0.5em; }
        p { color: #888; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📺 YLEM</h1>
        <p>Your TV Hub is ready!</p>
        <p>Configure channels in NPM to get started.</p>
    </div>
</body>
</html>'''
        (install_path / 'data' / 'index.html').write_text(index_html, encoding='utf-8')
        self.log("  ✓ index.html")
    
    def generate_env_file(self, install_path):
        """Generate .env file"""
        env = f"""# Ylem Configuration
# Generated by Ylem Installer

# Network
HOST_IP={self.config['host_ip']}
DOMAIN={self.config['domain']}

# Ports
NPM_HTTP_PORT={self.config['npm_http_port']}
NPM_HTTPS_PORT={self.config['npm_https_port']}
NPM_ADMIN_PORT={self.config['npm_admin_port']}
GAME_SERVER_PORT={self.config.get('game_server_port', '3000')}
EPG_SERVER_PORT={self.config.get('epg_server_port', '3001')}
ERSATZTV_PORT={self.config['ersatztv_port']}

# DuckDNS (Dynamic DNS)
DUCKDNS_ENABLED={str(self.config['duckdns_enabled']).lower()}
DUCKDNS_SUBDOMAIN={self.config['duckdns_subdomain']}
DUCKDNS_TOKEN={self.config['duckdns_token']}

# Channels are automatically loaded from ErsatzTV
# No manual configuration needed!
"""
        (install_path / '.env').write_text(env, encoding='utf-8')
    
    def generate_nginx_config(self, install_path):
        """Generate nginx config"""
        config = f"""# Ylem - Nginx Proxy Manager Advanced Config
# Paste into NPM -> Proxy Host -> Advanced

location = / {{
    root /data;
    try_files /index.html =404;
}}

location ~ ^/ch\\d+$ {{
    root /data;
    try_files /watch.html =404;
}}

location /iptv/ {{
    proxy_pass http://{self.config['host_ip']}:{self.config['ersatztv_port']}/iptv/;
    proxy_http_version 1.1;
    proxy_buffering off;
}}
"""
        
        if self.selected_components['games'].get():
            config += f"""
location /ws/ {{
    proxy_pass http://{self.config['host_ip']}:{self.config['game_server_port']}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}}

location /v2/ {{
    root /data;
    try_files $uri $uri/ =404;
}}

location = /games {{
    root /data;
    try_files /v2/games.html =404;
}}
"""
        
        if self.selected_components['tv'].get():
            config += f"""
location ^~ /api/epg {{
    proxy_pass http://{self.config['host_ip']}:{self.config['epg_server_port']};
    proxy_http_version 1.1;
}}

location = /guide {{
    root /data;
    try_files /v2/guide.html =404;
}}
"""
        
        (install_path / 'setup' / 'templates' / 'nginx-advanced.conf').write_text(config, encoding='utf-8')
    
    def generate_docker_compose(self, install_path):
        """Generate docker-compose.yml"""
        compose = f"""version: '3.8'

services:
  app:
    image: 'jc21/nginx-proxy-manager:latest'
    container_name: ylem-npm
    restart: unless-stopped
    ports:
      - '{self.config['npm_http_port']}:80'
      - '{self.config['npm_https_port']}:443'
      - '{self.config['npm_admin_port']}:81'
    volumes:
      - ./npm-data:/data
      - ./letsencrypt:/etc/letsencrypt
      - ./data:/data/data:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
"""
        
        if self.selected_components['tv'].get():
            compose += f"""
  epg-server:
    image: 'node:20-alpine'
    container_name: ylem-epg-server
    restart: unless-stopped
    working_dir: /app
    command: node epg-server.js
    ports:
      - '{self.config['epg_server_port']}:3001'
    volumes:
      - ./epg-server:/app:ro
    environment:
      - PORT=3001
      - HOST_IP={self.config['host_ip']}
      - ERSATZTV_PORT={self.config['ersatztv_port']}
    extra_hosts:
      - "host.docker.internal:host-gateway"
"""
        
        if self.selected_components['games'].get():
            compose += f"""
  game-server:
    image: 'node:20-alpine'
    container_name: ylem-game-server
    restart: unless-stopped
    working_dir: /app
    command: sh -c "npm install && node server.js"
    ports:
      - '{self.config['game_server_port']}:3000'
    volumes:
      - ./game-server:/app
    environment:
      - PORT=3000
"""
        
        (install_path / 'docker-compose.yml').write_text(compose, encoding='utf-8')
    
    def generate_scripts(self, install_path):
        """Generate helper scripts"""
        # Start script
        start_script = f"""@echo off
echo Starting Ylem...
cd /d "{install_path}"
docker-compose up -d
echo.
echo Ylem is running!
echo   Web: http://{self.config['host_ip']}:{self.config['npm_http_port']}
echo   Admin: http://{self.config['host_ip']}:{self.config['npm_admin_port']}
pause
"""
        (install_path / 'start.bat').write_text(start_script, encoding='utf-8')
        
        # Stop script
        stop_script = f"""@echo off
echo Stopping Ylem...
cd /d "{install_path}"
docker-compose down
echo Ylem stopped.
pause
"""
        (install_path / 'stop.bat').write_text(stop_script, encoding='utf-8')
        
        self.log("  ✓ start.bat")
        self.log("  ✓ stop.bat")


# ═══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    root = tk.Tk()
    app = YlemInstaller(root)
    root.mainloop()


if __name__ == '__main__':
    main()
