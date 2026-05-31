#!/bin/bash
# Binwak - server initialization script
# For: Ubuntu 20.04+ / Debian 11+
# Usage: chmod +x setup.sh && ./setup.sh

set -e

echo "=========================================="
echo "  Binwak server initialization"
echo "=========================================="

# 1. System update
echo "[1/5] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20
echo "[2/5] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# 3. Install PM2
echo "[3/5] Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi
echo "PM2 version: $(pm2 -v)"

# 4. Install Nginx
echo "[4/5] Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt install -y nginx
fi
sudo systemctl enable nginx
sudo systemctl start nginx
echo "Nginx version: $(nginx -v 2>&1)"

# 5. Create application directory
echo "[5/5] Creating application directory..."
APP_DIR="/home/$(whoami)/binwak"
mkdir -p "$APP_DIR"

echo ""
echo "=========================================="
echo "  Initialization complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Upload the code to $APP_DIR"
echo "  2. cd $APP_DIR/server && npm install --production"
echo "  3. Copy .env.example to .env and configure it"
echo "  4. npm run build"
echo "  5. pm2 start ecosystem.config.js"
echo "  6. Configure Nginx (see deploy/nginx-*.conf)"
echo ""
