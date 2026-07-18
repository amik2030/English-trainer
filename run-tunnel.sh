#!/bin/bash
# Auto-restart cloudflare tunnel
while true; do
    echo "[$(date)] Starting cloudflared tunnel..."
    cloudflared tunnel --url http://localhost:8000 2>&1 | tee -a /tmp/cloudflared.log | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 > /tmp/cloudflared-url.txt
    echo "[$(date)] Tunnel died, restarting in 3s..."
    sleep 3
done
