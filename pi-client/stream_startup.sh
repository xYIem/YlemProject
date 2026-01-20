#!/bin/bash
export WAYLAND_DISPLAY=wayland-0

# Logging
LOG="/home/ylem/stream_startup.log"
echo "=== Seamless Stream started at $(date) ===" > "$LOG"

# Wait for desktop
sleep 10

# Start diagnostics reporter in background
echo "Starting diagnostics reporter..." >> "$LOG"
python3 /home/ylem/pi_reporter.py > /home/ylem/pi_reporter.log 2>&1 &

# Give reporter a moment to start
sleep 2

# Start MPV once.
# --idle keeps MPV open even if the stream drops.
# --input-ipc-server creates the "doorway" for the remote to talk to it.
mpv --fullscreen \
    --idle \
    --input-ipc-server=/tmp/mpvsocket \
    --video-aspect-override=4:3 \
    --vf=crop=1440:1080:240:0 \
    --vo=gpu \
    --hwdec=auto \
    --no-osc --no-osd-bar \
    --osd-align-x=center \
    --osd-align-y=center \
    --osd-font-size=55 \
    "http://__HOST_IP__:8409/iptv/channel/2000.ts" >> "$LOG" 2>&1