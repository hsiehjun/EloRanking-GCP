#!/usr/bin/env bash
# ==============================================================================
# PHASE 1 PRODUCTION SETUP SCRIPT (Gunicorn + Uvicorn + Nginx)
# ==============================================================================
set -e

echo "=== [1/5] Installing Gunicorn & Production Dependencies ==="
pip3 install -r requirements.txt

echo "=== [2/5] Installing & Configuring Nginx Reverse Proxy ==="
if ! command -v nginx &> /dev/null; then
    sudo apt update && sudo apt install -y nginx
fi

sudo cp deploy/nginx/wh40k-elo.conf /etc/nginx/sites-available/wh40k-elo.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/wh40k-elo.conf /etc/nginx/sites-enabled/wh40k-elo.conf
sudo nginx -t
sudo systemctl restart nginx

echo "=== [3/5] Installing Multi-Worker Gunicorn Systemd Service ==="
sudo cp deploy/systemd/elo-ranking.service /etc/systemd/system/elo-ranking.service
sudo systemctl daemon-reload
sudo systemctl enable elo-ranking
sudo systemctl restart elo-ranking

echo "=== [4/5] Checking Service Health ==="
sleep 2
sudo systemctl status elo-ranking --no-pager
curl -I http://127.0.0.1:8080/

echo "======================================================================"
echo "🎉 Phase 1 Production Scaling Successfully Deployed!"
echo "   - Gunicorn Workers: 4x Async Uvicorn Processes"
echo "   - Nginx Reverse Proxy: HTTP Gzip Compression & Edge Caching Enabled"
echo "   - Web App URL: https://wh40k-elo.duckdns.org/"
echo "   - Swagger Docs: https://wh40k-elo.duckdns.org/docs"
echo "======================================================================"
