#!/bin/bash
echo "================================================="
echo "⚡ ZENITSU LIVE BOT — VPS ONE-CLICK UPDATE SCRIPT"
echo "================================================="
echo "[1/4] Pulling latest code from GitHub..."
git pull origin main

echo "[2/4] Installing production dependencies..."
npm install --omit=dev

echo "[3/4] Registering slash commands with Discord..."
node deploy-commands.js

echo "[4/4] Restarting PM2 process..."
if command -v pm2 &> /dev/null; then
  pm2 restart index.js || pm2 restart all || pm2 start index.js --name "zenitsu-bot"
else
  echo "PM2 not found. Starting with Node..."
  npm start
fi

echo "================================================="
echo "✅ UPDATE COMPLETE! Bot is live with v6.0 build."
echo "================================================="
