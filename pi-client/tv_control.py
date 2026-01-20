#!/usr/bin/env python3
"""
GE 1989 Remote - TV Channel Controller
Uses position 13 detection to identify Prev Chan button
"""
import os
import time
import struct

# --- DETECTION SETTINGS ---
HEADER_MIN = 3200
HEADER_MAX = 3600
LONG_THRESHOLD = 2000

# --- CHANNEL SETTINGS ---
channels = ["2000", "2001", "2002", "2003"]
current_idx = 0
last_trigger = 0
DEBOUNCE_SECONDS = 1.0  # Ignore repeats for 1 second

fd = os.open("/dev/lirc0", os.O_RDONLY | os.O_NONBLOCK)


def is_prev_chan(pulses):
    """
    Detects Prev Chan button from GE 1989 remote.

    Key difference found through profiling:
    - Power button has LONG pulses at positions [3, 7, 15] (3 total)
    - Prev Chan has LONG pulses at positions [3, 7, 13, 15] (4 total)

    The discriminator is position 13 - LONG for Prev Chan, short for Power.
    """
    if len(pulses) < 18:
        return False

    # Find header start (skip any leading garbage)
    start_idx = -1
    for i in range(len(pulses) - 17):
        if HEADER_MIN < pulses[i] < HEADER_MAX and 3100 < pulses[i+1] < 3500:
            start_idx = i
            break

    if start_idx == -1:
        return False

    # Extract command portion (16 pulses after header)
    cmd = pulses[start_idx + 2 : start_idx + 18]

    if len(cmd) < 16:
        return False

    # THE KEY: Position 13 is LONG (>2000) for Prev Chan, short (~870) for Power
    return cmd[13] > LONG_THRESHOLD


print("=" * 50)
print("📺 GE 1989 REMOTE - CHANNEL CONTROLLER")
print("=" * 50)
print(f"Channels: {channels}")
print(f"Starting on: {channels[current_idx]}")
print("Press 'Prev Chan' to cycle channels")
print("-" * 50)

while True:
    try:
        data = os.read(fd, 2048)
        if len(data) > 40:
            pulses = [struct.unpack('I', data[i:i+4])[0] & 0xFFFFFF for i in range(0, len(data), 4)]

            if is_prev_chan(pulses):
                now = time.time()
                if now - last_trigger > DEBOUNCE_SECONDS:
                    current_idx = (current_idx + 1) % len(channels)
                    new_ch = channels[current_idx]
                    print(f"✅ PREV CHAN! → Channel {new_ch}")
                    os.system(f"echo 'show-text \"CHANNEL: {new_ch}\" 3000' | socat - /tmp/mpvsocket")
                    os.system(f"echo 'loadfile \"http://__HOST_IP__:8409/iptv/channel/{new_ch}.ts\" replace' | socat - /tmp/mpvsocket")
                    last_trigger = now
            # Silently ignore other buttons (no spam!)

    except BlockingIOError:
        time.sleep(0.1)