# ZENITSU LIVE Bot — Koyeb Deployment Guide
> Free 24/7 hosting — no credit card required

---

## What You Need
- A **GitHub account** (free) → github.com
- A **Koyeb account** (free) → koyeb.com

---

## STEP 1 — Create a GitHub Repository

1. Go to **github.com** → click **"New"** (green button)
2. Name it: `zenitsu-live-bot`
3. Set to **Private** ← important (keeps your token safe)
4. Click **"Create repository"**

---

## STEP 2 — Upload Your Bot Files to GitHub

Open the folder:
```
C:\Users\Admin\.gemini\antigravity\scratch\ZenitsuLiveBot
```

Upload these files to your GitHub repo (drag & drop in browser):
```
✅ index.js
✅ dashboard.js
✅ config.js
✅ deploy-commands.js
✅ package.json
✅ package-lock.json
✅ Dockerfile
✅ .dockerignore
✅ modules/
✅ src/
✅ commands/
✅ dashboard/
```

❌ DO NOT upload:
```
.env                ← contains your secret token
node_modules/       ← too large
data/               ← runtime SQLite database (auto-generated)
logs/               ← runtime log files
audit-data.json     ← legacy, not used anymore
database.json       ← legacy, replaced by SQLite in data/zenitsu.db
```

---

## STEP 3 — Sign Up on Koyeb

1. Go to **app.koyeb.com**
2. Click **"Sign up"**
3. Sign up with your **GitHub account** ← easiest option
4. Verify your email

---

## STEP 4 — Create a New App on Koyeb

1. Click **"Create App"**
2. Choose **"GitHub"** as source
3. Select your **zenitsu-live-bot** repo
4. Select branch: **main**
5. Koyeb will auto-detect the Dockerfile ✅

---

## STEP 5 — Configure the Service

Set these settings:

| Setting | Value |
|---|---|
| **Instance type** | Free (Eco) |
| **Region** | Pick closest to India (Singapore or Frankfurt) |
| **Port** | 8080 |
| **Run command** | `node index.js` |

---

## STEP 6 — Add Environment Variables (IMPORTANT)

In the **"Environment Variables"** section, add ALL of these:

| Key | Value |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token from the Developer Portal |
| `CLIENT_ID` | `1488445899448385627` |
| `GUILD_ID` | `1444533392518680719` |
| `CATEGORY_TICKETS` | `1521562030040027366` |
| `CHANNEL_WELCOME` | `1521562002810736831` |
| `CHANNEL_REPORTS` | `1521562028114710598` |
| `CHANNEL_FEEDBACK` | `1521562022477566174` |
| `CHANNEL_PANEL` | `1521562007646503172` |
| `DASHBOARD_PASSCODE` | A strong private dashboard password, 12+ characters |
| `DASHBOARD_COOKIE_SECRET` | A different long random secret for signed cookies |
| `CHANNEL_SONG_REQUEST` | `1521562012935520348` |
| `SERVER_LOGS_ID` | `1521577044687847464` |
| `VOICE_LOG_ID` | `1521577051516047573` |
| `MOD_LOG_ID` | `1521577060689248519` |

---

## STEP 7 — Deploy!

1. Click **"Deploy"**
2. Wait ~2-3 minutes for build
3. Status turns **green** = bot is live 24/7 ✅

---

## After Deployment

- Stop the bot running on your PC (it's now running on Koyeb)
- Koyeb will **auto-restart** the bot if it ever crashes
- Your bot runs **24/7** even when your PC is off

---

## Updating the Bot in Future

1. Edit your files locally
2. Upload changed files to GitHub
3. Koyeb auto-deploys the new version in ~2 mins ✅
