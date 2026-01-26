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
        self.root.geometry("750x720")
        self.root.resizable(True, True)
        self.root.minsize(700, 680)
        
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
            'install_path': '',  # Empty - user must set
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
        steps = ['Components', 'Network', 'Summary', 'Install', 'Setup']
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
            self.create_components_page,      # 0 - Select components
            self.create_network_page,         # 1 - IP, Ports, Domain
            self.create_summary_page,         # 2 - Review settings
            self.create_install_page,         # 3 - Download & install
            self.create_setup_page,           # 4 - NPM setup guide
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
        
        # Track if installation has completed
        if not hasattr(self, 'installation_complete'):
            self.installation_complete = False
        
        # Update navigation based on page and installation state
        if index == 0:
            self.back_btn.config(state=tk.DISABLED)
        elif index == 3 and self.installation_complete:
            # On install page after completion, allow back to review
            self.back_btn.config(state=tk.NORMAL, command=self.prev_page)
        elif index == 4:
            # Setup page - no going back
            self.back_btn.config(state=tk.DISABLED)
        else:
            self.back_btn.config(state=tk.NORMAL, command=self.prev_page)
        
        # Configure Next button based on page
        if index == 2:  # Summary page (index 2)
            self.next_btn.config(text="Install →", command=self.next_page, state=tk.NORMAL)
        elif index == 3:  # Install page (index 3)
            if self.installation_complete:
                self.next_btn.config(text="Next → Setup", command=lambda: self.show_page(4), state=tk.NORMAL)
            else:
                self.next_btn.config(text="Installing...", state=tk.DISABLED)
        elif index == 4:  # Setup page (index 4)
            self.next_btn.config(text="Finish", command=self.root.quit, state=tk.NORMAL)
        else:
            self.next_btn.config(text="Next →", command=self.next_page, state=tk.NORMAL)
        
        self.current_page = index
        self.update_progress(index)
        self.pages[index]()
    
    def next_page(self):
        """Go to next page"""
        # Validate current page
        if not self.validate_page():
            return
        
        if self.current_page == 2:  # Summary -> Install
            self.show_page(3)
            # Only start installation if not already done
            if not self.installation_complete:
                self.start_installation()
        elif self.current_page < len(self.pages) - 1:
            self.show_page(self.current_page + 1)
    
    def prev_page(self):
        """Go to previous page"""
        if self.current_page > 0:
            # Don't go back from setup page
            if self.current_page == 4:
                return
            self.show_page(self.current_page - 1)
    
    def validate_page(self):
        """Validate current page before proceeding"""
        if self.current_page == 0:  # Components page
            if not self.install_path_var.get().strip():
                messagebox.showerror("Error", "Please select an installation folder")
                return False
            self.config['install_path'] = self.install_path_var.get().strip()
        elif self.current_page == 1:  # Network page (now includes ports and domain)
            if not self.host_ip_var.get():
                messagebox.showerror("Error", "Please enter your local IP address")
                return False
            self.config['host_ip'] = self.host_ip_var.get()
            self.config['ersatztv_port'] = self.ersatztv_port_var.get()
            # Ports
            for key, var in self.port_vars.items():
                self.config[key] = var.get()
            # Domain
            self.config['domain'] = self.domain_var.get()
            self.config['duckdns_enabled'] = self.duckdns_enabled_var.get()
            self.config['duckdns_subdomain'] = self.duckdns_subdomain_var.get()
            self.config['duckdns_token'] = self.duckdns_token_var.get()
        return True

    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 1: Component Selection
    # ═══════════════════════════════════════════════════════════════════════════
    def create_components_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Select Components", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Choose which parts of Ylem to install", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 10))
        
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
        path_frame = ttk.LabelFrame(frame, text="Installation Path (Required)", padding="10")
        path_frame.pack(fill=tk.X, pady=(10, 5))
        
        path_row = ttk.Frame(path_frame)
        path_row.pack(fill=tk.X)
        
        self.install_path_var = tk.StringVar(value=self.config['install_path'])
        path_entry = ttk.Entry(path_row, textvariable=self.install_path_var, width=50)
        path_entry.pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(path_row, text="Browse...", command=self.browse_install_path).pack(side=tk.LEFT)
        
        ttk.Label(path_frame, text="Example: C:\\Ylem or D:\\MyServer\\Ylem", 
                  foreground='gray').pack(anchor='w', pady=(5, 0))
        
        # Prerequisites with status checks
        prereq_frame = ttk.LabelFrame(frame, text="Prerequisites", padding="10")
        prereq_frame.pack(fill=tk.X, pady=(5, 0))
        
        # Check prerequisites
        self.prereq_status = {}
        self._check_prerequisites()
        
        # Docker Desktop
        docker_frame = ttk.Frame(prereq_frame)
        docker_frame.pack(fill=tk.X, pady=2)
        
        docker_status = "✓" if self.prereq_status.get('docker') else "✗"
        docker_color = "green" if self.prereq_status.get('docker') else "red"
        ttk.Label(docker_frame, text=docker_status, foreground=docker_color, width=3).pack(side=tk.LEFT)
        ttk.Label(docker_frame, text="Docker Desktop", width=18, anchor='w').pack(side=tk.LEFT)
        
        if self.prereq_status.get('docker'):
            ttk.Label(docker_frame, text="Installed", foreground='green').pack(side=tk.LEFT)
        else:
            docker_link = ttk.Label(docker_frame, text="Download", foreground='blue', cursor='hand2')
            docker_link.pack(side=tk.LEFT)
            docker_link.bind('<Button-1>', lambda e: self.open_url('https://www.docker.com/products/docker-desktop/'))
            ttk.Label(docker_frame, text=" (Required)", foreground='red').pack(side=tk.LEFT)
        
        # Docker Running check
        if self.prereq_status.get('docker'):
            running_frame = ttk.Frame(prereq_frame)
            running_frame.pack(fill=tk.X, pady=2)
            
            running_status = "✓" if self.prereq_status.get('docker_running') else "✗"
            running_color = "green" if self.prereq_status.get('docker_running') else "orange"
            ttk.Label(running_frame, text=running_status, foreground=running_color, width=3).pack(side=tk.LEFT)
            ttk.Label(running_frame, text="Docker Running", width=18, anchor='w').pack(side=tk.LEFT)
            
            if self.prereq_status.get('docker_running'):
                ttk.Label(running_frame, text="Running", foreground='green').pack(side=tk.LEFT)
            else:
                ttk.Label(running_frame, text="Start Docker Desktop", foreground='orange').pack(side=tk.LEFT)
        
        # ErsatzTV
        etv_frame = ttk.Frame(prereq_frame)
        etv_frame.pack(fill=tk.X, pady=2)
        
        etv_status = "✓" if self.prereq_status.get('ersatztv') else "?"
        etv_color = "green" if self.prereq_status.get('ersatztv') else "gray"
        ttk.Label(etv_frame, text=etv_status, foreground=etv_color, width=3).pack(side=tk.LEFT)
        ttk.Label(etv_frame, text="ErsatzTV", width=18, anchor='w').pack(side=tk.LEFT)
        
        if self.prereq_status.get('ersatztv'):
            ttk.Label(etv_frame, text=f"Found on port {self.prereq_status.get('ersatztv_port', '8409')}", 
                      foreground='green').pack(side=tk.LEFT)
        else:
            etv_link = ttk.Label(etv_frame, text="Download", foreground='blue', cursor='hand2')
            etv_link.pack(side=tk.LEFT)
            etv_link.bind('<Button-1>', lambda e: self.open_url('https://github.com/ErsatzTV/ErsatzTV/releases'))
            ttk.Label(etv_frame, text=" (Required for TV)", foreground='gray').pack(side=tk.LEFT)
        
        # Refresh button
        btn_frame = ttk.Frame(prereq_frame)
        btn_frame.pack(fill=tk.X, pady=(10, 0))
        ttk.Button(btn_frame, text="🔄 Recheck", command=self._refresh_prerequisites).pack(side=tk.LEFT)
        
        # Store frame reference for refresh
        self._prereq_frame_parent = frame
    
    def _check_prerequisites(self):
        """Check if required programs are installed"""
        # Check Docker
        try:
            result = subprocess.run(['docker', '--version'], capture_output=True, text=True, timeout=5)
            self.prereq_status['docker'] = result.returncode == 0
        except:
            self.prereq_status['docker'] = False
        
        # Check if Docker is running
        if self.prereq_status['docker']:
            try:
                result = subprocess.run(['docker', 'ps'], capture_output=True, text=True, timeout=10)
                self.prereq_status['docker_running'] = result.returncode == 0
            except:
                self.prereq_status['docker_running'] = False
        else:
            self.prereq_status['docker_running'] = False
        
        # Check ErsatzTV (try to connect to default port)
        self.prereq_status['ersatztv'] = False
        for port in ['8409', '8410']:
            try:
                import urllib.request
                req = urllib.request.urlopen(f'http://localhost:{port}', timeout=2)
                self.prereq_status['ersatztv'] = True
                self.prereq_status['ersatztv_port'] = port
                break
            except:
                pass
    
    def _refresh_prerequisites(self):
        """Refresh prerequisite checks and redraw page"""
        self._check_prerequisites()
        self.show_page(0)  # Redraw the components page
    
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
    # PAGE 2: Network Configuration (IP + Ports + Domain)
    # ═══════════════════════════════════════════════════════════════════════════
    def create_network_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        # Make it scrollable for smaller screens
        canvas = tk.Canvas(frame, highlightthickness=0)
        scrollbar = ttk.Scrollbar(frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Bind mousewheel
        canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(int(-1*(e.delta/120)), "units"))
        
        ttk.Label(scrollable_frame, text="Network Configuration", style='Header.TLabel').pack(anchor='w', padx=10)
        ttk.Label(scrollable_frame, text="IP, Ports, and Domain settings", 
                  style='SubHeader.TLabel').pack(anchor='w', padx=10, pady=(0, 15))
        
        # === Host IP ===
        ip_frame = ttk.LabelFrame(scrollable_frame, text="Local IP Address", padding="10")
        ip_frame.pack(fill=tk.X, pady=5, padx=10)
        
        ip_row = ttk.Frame(ip_frame)
        ip_row.pack(fill=tk.X)
        
        self.host_ip_var = tk.StringVar(value=self.config['host_ip'])
        ttk.Entry(ip_row, textvariable=self.host_ip_var, width=18, font=('Consolas', 11)).pack(side=tk.LEFT, padx=(0, 10))
        ttk.Button(ip_row, text="Auto-Detect", command=self.detect_ip).pack(side=tk.LEFT)
        ttk.Label(ip_frame, text="Your PC's local network IP", foreground='gray').pack(anchor='w', pady=(5, 0))
        
        # === ErsatzTV Port ===
        self.ersatztv_port_var = tk.StringVar(value=self.config['ersatztv_port'])
        if self.selected_components['tv'].get():
            etv_frame = ttk.LabelFrame(scrollable_frame, text="ErsatzTV Port", padding="10")
            etv_frame.pack(fill=tk.X, pady=5, padx=10)
            ttk.Entry(etv_frame, textvariable=self.ersatztv_port_var, width=8, font=('Consolas', 11)).pack(side=tk.LEFT)
            ttk.Label(etv_frame, text="  Default: 8409", foreground='gray').pack(side=tk.LEFT)
        
        # === Ports ===
        ports_frame = ttk.LabelFrame(scrollable_frame, text="Service Ports", padding="10")
        ports_frame.pack(fill=tk.X, pady=5, padx=10)
        
        self.port_vars = {}
        
        port_grid = ttk.Frame(ports_frame)
        port_grid.pack(fill=tk.X)
        
        ports = [
            ('npm_http_port', 'HTTP', '80'),
            ('npm_https_port', 'HTTPS', '443'),
            ('npm_admin_port', 'Admin', '81'),
        ]
        
        if self.selected_components['games'].get():
            ports.append(('game_server_port', 'Games', '3000'))
        if self.selected_components['tv'].get():
            ports.append(('epg_server_port', 'EPG', '3001'))
        
        for i, (key, label, default) in enumerate(ports):
            row = i // 3
            col = i % 3
            
            cell = ttk.Frame(port_grid)
            cell.grid(row=row, column=col, padx=10, pady=5, sticky='w')
            
            ttk.Label(cell, text=f"{label}:").pack(side=tk.LEFT)
            self.port_vars[key] = tk.StringVar(value=self.config.get(key, default))
            ttk.Entry(cell, textvariable=self.port_vars[key], width=6, font=('Consolas', 10)).pack(side=tk.LEFT, padx=(5, 0))
        
        ttk.Label(ports_frame, text="Use 9080/9443/9081 for testing alongside existing install", 
                  foreground='gray').pack(anchor='w', pady=(5, 0))
        
        # === Domain ===
        domain_frame = ttk.LabelFrame(scrollable_frame, text="Domain (Optional)", padding="10")
        domain_frame.pack(fill=tk.X, pady=5, padx=10)
        
        self.domain_var = tk.StringVar(value=self.config['domain'])
        ttk.Entry(domain_frame, textvariable=self.domain_var, width=30, font=('Consolas', 11)).pack(side=tk.LEFT)
        ttk.Label(domain_frame, text="  e.g., ylem.example.com (blank for local only)", foreground='gray').pack(side=tk.LEFT)
        
        # === DuckDNS ===
        duck_frame = ttk.LabelFrame(scrollable_frame, text="Dynamic DNS - DuckDNS (Optional)", padding="10")
        duck_frame.pack(fill=tk.X, pady=5, padx=10)
        
        self.duckdns_enabled_var = tk.BooleanVar(value=self.config['duckdns_enabled'])
        ttk.Checkbutton(duck_frame, text="Enable DuckDNS auto-update", 
                        variable=self.duckdns_enabled_var).pack(anchor='w')
        
        duck_row = ttk.Frame(duck_frame)
        duck_row.pack(fill=tk.X, pady=(5, 0))
        
        ttk.Label(duck_row, text="Subdomain:").pack(side=tk.LEFT)
        self.duckdns_subdomain_var = tk.StringVar(value=self.config['duckdns_subdomain'])
        ttk.Entry(duck_row, textvariable=self.duckdns_subdomain_var, width=15).pack(side=tk.LEFT, padx=5)
        ttk.Label(duck_row, text=".duckdns.org").pack(side=tk.LEFT)
        
        ttk.Label(duck_row, text="   Token:").pack(side=tk.LEFT)
        self.duckdns_token_var = tk.StringVar(value=self.config['duckdns_token'])
        ttk.Entry(duck_row, textvariable=self.duckdns_token_var, width=20, show='*').pack(side=tk.LEFT, padx=5)
        
        # Auto-detect IP on page load
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
    # PAGE 3: Summary
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
                dirs.extend(['game-server', 'game-server/shared', 'web/v2/css', 'web/v2/js', 'web/v2/games', 'web/v2/games/boggle', 'web/v2/games/scrabble'])
            if self.selected_components['tv'].get():
                dirs.extend(['epg-server', 'epg-server/logos'])
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
            
            # Complete install page
            self.install_progress['value'] = 100
            self.status_var.set("Installation complete!")
            
            self.log("\n" + "="*50)
            self.log("FILES INSTALLED SUCCESSFULLY!")
            self.log("="*50)
            self.log(f"\nInstalled to: {install_path}")
            self.log("\nClick 'Next → Setup' to start Docker and configure NPM.")
            
            # Mark installation as complete
            self.installation_complete = True
            self.final_install_path = install_path
            
            # Update buttons on main thread
            self.root.after(0, self._show_install_complete_buttons, install_path)
            
        except Exception as e:
            self.log(f"\nERROR: {str(e)}")
            self.status_var.set("Installation failed!")
            messagebox.showerror("Error", f"Installation failed:\n{str(e)}")
    
    def _show_install_complete_buttons(self, install_path):
        """Show buttons after install completes"""
        # Clear nav frame and rebuild
        for widget in self.nav_frame.winfo_children():
            widget.destroy()
        
        # Back button - can go back to review settings
        self.back_btn = ttk.Button(self.nav_frame, text="← Back", command=self.prev_page)
        self.back_btn.pack(side=tk.LEFT, padx=5)
        
        # Next button to setup page
        self.next_btn = ttk.Button(self.nav_frame, text="Next → Setup", 
                                   command=lambda: self.show_page(4))
        self.next_btn.pack(side=tk.RIGHT, padx=5)
    
    def _start_docker_cmd(self, install_path):
        """Start docker-compose in a visible CMD window"""
        try:
            # Create a batch file to run docker-compose and keep window open
            batch_content = f'''@echo off
cd /d "{install_path}"
echo.
echo ========================================
echo   Starting Ylem Docker Containers
echo ========================================
echo.
echo Running: docker-compose up -d
echo.
docker-compose up -d
echo.
echo ========================================
echo   Docker Status
echo ========================================
echo.
docker ps
echo.
echo ----------------------------------------
echo Press any key to close this window...
pause >nul
'''
            batch_path = install_path / '_start_docker.bat'
            batch_path.write_text(batch_content, encoding='utf-8')
            
            # Run the batch file in a new CMD window
            subprocess.Popen(['cmd', '/c', 'start', 'cmd', '/k', str(batch_path)], 
                           cwd=str(install_path))
            
            self.log("\n→ Docker CMD window opened!")
            
        except Exception as e:
            self.log(f"\nError opening CMD: {str(e)}")
            messagebox.showerror("Error", f"Failed to open CMD:\n{str(e)}")
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PAGE 5: Setup Guide
    # ═══════════════════════════════════════════════════════════════════════════
    def create_setup_page(self):
        frame = ttk.Frame(self.page_frame)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Setup Complete!", style='Header.TLabel').pack(anchor='w')
        ttk.Label(frame, text="Configure NPM and access your sites", 
                  style='SubHeader.TLabel').pack(anchor='w', pady=(0, 10))
        
        # Docker Section
        docker_frame = ttk.LabelFrame(frame, text="Docker Containers", padding="10")
        docker_frame.pack(fill=tk.X, pady=5)
        
        docker_row = ttk.Frame(docker_frame)
        docker_row.pack(fill=tk.X)
        
        ttk.Button(docker_row, text="Start Docker (CMD)", 
                   command=lambda: self._start_docker_cmd(Path(self.config['install_path']))).pack(side=tk.LEFT, padx=5)
        ttk.Button(docker_row, text="Stop Docker (CMD)", 
                   command=lambda: self._stop_docker_cmd(Path(self.config['install_path']))).pack(side=tk.LEFT, padx=5)
        ttk.Label(docker_row, text="Opens a command window to see Docker output", 
                  foreground='gray').pack(side=tk.LEFT, padx=10)
        
        # NPM Setup Section
        npm_frame = ttk.LabelFrame(frame, text="Configure Nginx Proxy Manager", padding="10")
        npm_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(npm_frame, text="1. Click 'Open NPM Admin' below\n"
                  "2. Login with: admin@example.com / changeme\n"
                  "3. Add a Proxy Host:\n"
                  f"     Domain: {self.config['domain'] or self.config['host_ip']}\n"
                  f"     Forward: {self.config['host_ip']}:{self.config['npm_http_port']}\n"
                  "4. Click 'Copy Nginx Config' and paste in the Advanced tab",
                  justify=tk.LEFT).pack(anchor='w')
        
        btn_row1 = ttk.Frame(npm_frame)
        btn_row1.pack(fill=tk.X, pady=(10, 0))
        
        ttk.Button(btn_row1, text="Open NPM Admin", 
                   command=lambda: self.open_url(f"http://{self.config['host_ip']}:{self.config['npm_admin_port']}")).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_row1, text="Copy Nginx Config", 
                   command=self._copy_nginx_config_from_setup).pack(side=tk.LEFT, padx=5)
        
        # Your Links Section  
        links_frame = ttk.LabelFrame(frame, text="Your Ylem Sites (clickable)", padding="10")
        links_frame.pack(fill=tk.X, pady=10)
        
        base_url = f"http://{self.config['domain'] or self.config['host_ip']}"
        if self.config['npm_http_port'] != '80':
            base_url += f":{self.config['npm_http_port']}"
        
        # Create clickable links
        links = [
            ("Main Page", f"{base_url}/"),
        ]
        if self.selected_components['epg'].get():
            links.append(("TV Guide", f"{base_url}/guide"))
        if self.selected_components['games'].get():
            links.append(("Games Hub", f"{base_url}/games"))
        links.append(("NPM Admin", f"http://{self.config['host_ip']}:{self.config['npm_admin_port']}"))
        if self.selected_components['tv'].get():
            links.append(("EPG Health", f"http://{self.config['host_ip']}:{self.config['epg_server_port']}/health"))
        
        for name, url in links:
            link_row = ttk.Frame(links_frame)
            link_row.pack(fill=tk.X, pady=2)
            
            ttk.Label(link_row, text=f"{name}:", width=12, anchor='e').pack(side=tk.LEFT)
            link_label = ttk.Label(link_row, text=url, foreground='blue', cursor='hand2')
            link_label.pack(side=tk.LEFT, padx=5)
            link_label.bind('<Button-1>', lambda e, u=url: self.open_url(u))
        
        # Install folder
        folder_frame = ttk.LabelFrame(frame, text="Installation Location", padding="10")
        folder_frame.pack(fill=tk.X, pady=5)
        
        folder_row = ttk.Frame(folder_frame)
        folder_row.pack(fill=tk.X)
        
        ttk.Label(folder_row, text=str(self.config['install_path'])).pack(side=tk.LEFT)
        ttk.Button(folder_row, text="Open Folder", 
                   command=lambda: os.startfile(str(self.config['install_path']))).pack(side=tk.LEFT, padx=10)
        
        # Update nav buttons
        self.back_btn.config(state=tk.DISABLED)
        self.next_btn.config(text="Finish", command=self.root.quit)
    
    def _stop_docker_cmd(self, install_path):
        """Stop docker-compose in a visible CMD window"""
        try:
            batch_content = f'''@echo off
cd /d "{install_path}"
echo.
echo ========================================
echo   Stopping Ylem Docker Containers
echo ========================================
echo.
docker-compose down
echo.
echo Done! Containers stopped.
echo.
pause
'''
            batch_path = install_path / '_stop_docker.bat'
            batch_path.write_text(batch_content, encoding='utf-8')
            
            subprocess.Popen(['cmd', '/c', 'start', 'cmd', '/k', str(batch_path)], 
                           cwd=str(install_path))
            
        except Exception as e:
            messagebox.showerror("Error", f"Failed to open CMD:\n{str(e)}")
    
    def _copy_nginx_config_from_setup(self):
        """Copy nginx config to clipboard from setup page"""
        try:
            install_path = Path(self.config['install_path'])
            config_path = install_path / 'setup' / 'templates' / 'nginx-advanced.conf'
            config_text = config_path.read_text(encoding='utf-8')
            self.root.clipboard_clear()
            self.root.clipboard_append(config_text)
            messagebox.showinfo("Copied!", "Nginx config copied to clipboard!\n\nPaste it into NPM → Proxy Host → Advanced tab")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to copy: {str(e)}")
    
    def _run_docker_sync(self, install_path):
        """Run docker-compose up synchronously"""
        try:
            result = subprocess.run(
                ['docker-compose', 'up', '-d'],
                cwd=str(install_path),
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.returncode == 0:
                self.log(result.stdout)
                return True
            else:
                self.log(f"  Docker error: {result.stderr}")
                return False
        except subprocess.TimeoutExpired:
            self.log("  Docker timed out")
            return False
        except FileNotFoundError:
            self.log("  Docker not found. Is Docker Desktop installed and running?")
            return False
        except Exception as e:
            self.log(f"  Docker error: {str(e)}")
            return False
    
    def download_github_files(self, install_path):
        """Download files from GitHub"""
        import zipfile
        import io
        
        # GitHub raw URL for the repo
        base_url = f"https://raw.githubusercontent.com/{GITHUB_USER}/{GITHUB_REPO}/main"
        
        # Files to download based on selected components
        files_to_download = []
        
        # Core files (always needed)
        files_to_download.extend([
            ('data/index.html', 'data/index.html'),
            ('data/watch.html', 'data/watch.html'),
        ])
        
        # TV/EPG files
        if self.selected_components['tv'].get():
            files_to_download.extend([
                ('epg-server/epg-server.js', 'epg-server/epg-server.js'),
            ])
        
        # EPG Guide
        if self.selected_components['epg'].get():
            files_to_download.extend([
                ('web/v2/guide.html', 'web/v2/guide.html'),
            ])
        
        # Game files
        if self.selected_components['games'].get():
            files_to_download.extend([
                ('game-server/server.js', 'game-server/server.js'),
                ('game-server/package.json', 'game-server/package.json'),
                ('game-server/shared/index.js', 'game-server/shared/index.js'),
                ('web/v2/games.html', 'web/v2/games.html'),
                ('web/v2/games/boggle/boggle.html', 'web/v2/games/boggle/boggle.html'),
                ('web/v2/games/scrabble/scrabble.html', 'web/v2/games/scrabble/scrabble.html'),
                ('web/v2/games/scrabble/lobby.html', 'web/v2/games/scrabble/lobby.html'),
                ('web/v2/css/common.css', 'web/v2/css/common.css'),
                ('web/v2/css/auth.css', 'web/v2/css/auth.css'),
                ('web/v2/css/game-common.css', 'web/v2/css/game-common.css'),
                ('web/v2/css/inventory.css', 'web/v2/css/inventory.css'),
                ('web/v2/css/leaderboard.css', 'web/v2/css/leaderboard.css'),
                ('web/v2/css/wager.css', 'web/v2/css/wager.css'),
                ('web/v2/js/auth.js', 'web/v2/js/auth.js'),
                ('web/v2/js/config.js', 'web/v2/js/config.js'),
                ('web/v2/js/dictionary.js', 'web/v2/js/dictionary.js'),
                ('web/v2/js/inventory.js', 'web/v2/js/inventory.js'),
                ('web/v2/js/items.js', 'web/v2/js/items.js'),
                ('web/v2/js/leaderboard.js', 'web/v2/js/leaderboard.js'),
                ('web/v2/js/wager.js', 'web/v2/js/wager.js'),
            ])
        
        # Diagnostics
        if self.selected_components['diagnostics'].get():
            files_to_download.extend([
                ('diagnostics/collector.py', 'diagnostics/collector.py'),
                ('diagnostics/requirements.txt', 'diagnostics/requirements.txt'),
                ('diagnostics/static/dashboard.html', 'diagnostics/static/dashboard.html'),
            ])
        
        # Pi client
        if self.selected_components['pi_client'].get():
            files_to_download.extend([
                ('pi-client/pi_setup.sh', 'pi-client/pi_setup.sh'),
                ('pi-client/stream_startup.sh', 'pi-client/stream_startup.sh'),
                ('pi-client/tv_control.py', 'pi-client/tv_control.py'),
                ('pi-client/pi_reporter.py', 'pi-client/pi_reporter.py'),
                ('pi-client/boot/config.txt', 'pi-client/boot/config.txt'),
                ('pi-client/boot/cmdline.txt', 'pi-client/boot/cmdline.txt'),
            ])
        
        # Download each file
        success_count = 0
        fail_count = 0
        
        for remote_path, local_path in files_to_download:
            try:
                url = f"{base_url}/{remote_path}"
                self.log(f"  Downloading {remote_path}...")
                
                req = Request(url, headers={'User-Agent': 'YlemInstaller/1.0'})
                response = urlopen(req, timeout=30)
                content = response.read()
                
                # Ensure directory exists
                dest_file = install_path / local_path
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                
                # Write file
                dest_file.write_bytes(content)
                self.log(f"    ✓ {local_path}")
                success_count += 1
                
            except Exception as e:
                self.log(f"    ✗ Failed: {local_path} ({str(e)[:50]})")
                fail_count += 1
        
        self.log(f"\n  Downloaded: {success_count} files, Failed: {fail_count} files")
    
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
        compose = f"""services:
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
      - ./epg-server:/app
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
