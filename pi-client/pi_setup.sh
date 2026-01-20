#!/bin/bash
# ===========================================
# YLEM - Raspberry Pi Setup Script
# ===========================================
# Run this on a fresh Raspberry Pi to set it up
# for CRT TV streaming
#
# Usage: ./pi_setup.sh <HOST_IP> [DEFAULT_CHANNEL]
# Example: ./pi_setup.sh 192.168.1.100 2000
# ===========================================

set -e

# Check arguments
if [ -z "$1" ]; then
    echo "Usage: $0 <HOST_IP> [DEFAULT_CHANNEL]"
    echo "Example: $0 192.168.1.100 2000"
    exit 1
fi

HOST_IP="$1"
DEFAULT_CHANNEL="${2:-2000}"

echo "=== Ylem Pi Setup ==="
echo "Host IP: $HOST_IP"
echo "Default Channel: $DEFAULT_CHANNEL"
echo ""

# Update system
echo ">>> Updating system..."
sudo apt update && sudo apt upgrade -y

# Install required packages
echo ">>> Installing required packages..."
sudo apt install -y \
    mpv \
    python3-evdev \
    python3-requests \
    python3-psutil \
    ir-keytable

# Create directories
echo ">>> Creating directories..."
mkdir -p ~/.config/autostart

# Copy scripts from ylem-repo (assumes you've copied them to /tmp/ylem/)
SCRIPT_DIR="/tmp/ylem/pi-client"

if [ ! -d "$SCRIPT_DIR" ]; then
    echo "Error: $SCRIPT_DIR not found"
    echo "Please copy the pi-client folder to /tmp/ylem/ first"
    exit 1
fi

# Copy and configure tv_control.py
echo ">>> Setting up tv_control.py..."
sed "s/__HOST_IP__/$HOST_IP/g" "$SCRIPT_DIR/tv_control.py" > ~/tv_control.py
chmod +x ~/tv_control.py

# Copy and configure stream_startup.sh
echo ">>> Setting up stream_startup.sh..."
sed "s/__HOST_IP__/$HOST_IP/g; s/__DEFAULT_CHANNEL__/$DEFAULT_CHANNEL/g" \
    "$SCRIPT_DIR/stream_startup.sh" > ~/stream_startup.sh
chmod +x ~/stream_startup.sh

# Copy and configure pi_reporter.py
echo ">>> Setting up pi_reporter.py..."
sed "s/__HOST_IP__/$HOST_IP/g" "$SCRIPT_DIR/pi_reporter.py" > ~/pi_reporter.py
chmod +x ~/pi_reporter.py

# Copy autostart files
echo ">>> Setting up autostart..."
cp "$SCRIPT_DIR/autostart/ge-remote.desktop" ~/.config/autostart/
cp "$SCRIPT_DIR/autostart/mpv-stream.desktop" ~/.config/autostart/

# Update autostart files with correct paths
sed -i "s|/home/ylem|$HOME|g" ~/.config/autostart/*.desktop

# Backup and update boot config for CRT
echo ">>> Configuring boot settings..."
sudo cp /boot/firmware/config.txt /boot/firmware/config.txt.backup
sudo cp "$SCRIPT_DIR/boot/config.txt" /boot/firmware/config.txt
sudo cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.backup

# Note: cmdline.txt changes require manual review for safety
echo ""
echo "=== Setup Complete ==="
echo ""
echo "IMPORTANT: Review boot/cmdline.txt changes manually if needed:"
echo "  Current: $(cat /boot/firmware/cmdline.txt)"
echo "  Template: $(cat $SCRIPT_DIR/boot/cmdline.txt)"
echo ""
echo "To apply CRT display settings, add to /boot/firmware/cmdline.txt:"
echo "  video=Composite-1:720x480@60ie vc4.tv_norm=NTSC-M"
echo ""
echo "Reboot to apply changes: sudo reboot"
