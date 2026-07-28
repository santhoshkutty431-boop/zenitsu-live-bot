#!/bin/bash
echo "=========================================================="
echo "⚡ ZENITSU LIVE BOT — VPS HARD RESET & UPDATE"
echo "=========================================================="

echo "[1/4] Fetching latest code from GitHub..."
git fetch origin main
git reset --hard origin/main

echo "[2/4] Installing dependencies..."
npm install --omit=dev

echo "[3/4] Registering slash commands..."
node deploy-commands.js

echo "[4/4] Restarting bot process on VPS..."
if command -v pm2 &> /dev/null; then
  pm2 restart all || pm2 start index.js --name "zenitsu-bot"
else
  echo "Stopping any running node instances..."
  pkill -f "node index.js" || true
  nohup node index.js > bot.log 2>&1 &
  echo "Bot started in background with PID $!"
fi

echo "=========================================================="
echo "✅ HARD FIX APPLIED! Bot is running v6.0 on this VPS."
echo "=========================================================="
