import os
import sys
from huggingface_hub import HfApi

PROJECT_DIR = r"C:\Users\Admin\Pictures\Saved Pictures\ZenitsuLiveBot"
REPO_ID = "kutty-35/zenitsu-live-bot"

# Simple manual parser for .env file
def load_env(env_path):
    env_vars = {}
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_vars[key.strip()] = val.strip()
    return env_vars

# Load variables
env_vars = load_env(os.path.join(PROJECT_DIR, '.env'))

TOKEN = env_vars.get('HF_TOKEN')
if not TOKEN:
    print("[ERR] HF_TOKEN not found in .env file!")
    sys.exit(1)

api = HfApi()

try:
    print(f"[..] Creating Space: {REPO_ID} (Docker SDK)...")
    api.create_repo(
        repo_id=REPO_ID,
        repo_type="space",
        space_sdk="docker",
        token=TOKEN,
        exist_ok=True,
        private=False
    )
    print(f"[OK] Space is ready: https://huggingface.co/spaces/{REPO_ID}")
except Exception as e:
    print(f"[ERR] Failed to create Space: {e}")
    sys.exit(1)

# List of secrets to deploy (from .env file)
secrets_keys = [
    "DISCORD_TOKEN",
    "CLIENT_ID",
    "GUILD_ID",
    "CATEGORY_TICKETS",
    "CHANNEL_WELCOME",
    "CHANNEL_REPORTS",
    "CHANNEL_FEEDBACK",
    "CHANNEL_PANEL",
    "CHANNEL_SONG_REQUEST",
    "SERVER_LOGS_ID",
    "VOICE_LOG_ID",
    "MOD_LOG_ID"
]

print("\n[..] Setting Space Secrets...")
for key in secrets_keys:
    val = env_vars.get(key)
    if val:
        try:
            api.add_space_secret(
                repo_id=REPO_ID,
                key=key,
                value=val,
                token=TOKEN
            )
            print(f"  [OK] Secret set: {key}")
        except Exception as e:
            print(f"  [ERR] Failed to set secret {key}: {e}")
    else:
        print(f"  [WARN] Secret {key} not found in .env, skipping.")

# Set PORT secret by default
try:
    api.add_space_secret(repo_id=REPO_ID, key="PORT", value="8080", token=TOKEN)
    print("  [OK] Secret set: PORT")
except Exception as e:
    print(f"  [ERR] Failed to set PORT secret: {e}")

# Files to upload (include subdirectory files with their repo paths)
upload_files = [
    "index.js",
    "dashboard.js",
    "config.js",
    "deploy-commands.js",
    "package.json",
    "package-lock.json",
    "Dockerfile",
    ".dockerignore",
    "database.json",
    "commands/embed-handler.js",
    "modules/case-manager.js",
    "modules/auto-punish.js",
    "modules/security.js",
    "modules/logger.js",
]

print(f"\n[..] Uploading {len(upload_files)} files to Hugging Face Space...")
for fname in upload_files:
    full_path = os.path.join(PROJECT_DIR, fname.replace("/", os.sep))
    if os.path.exists(full_path):
        try:
            api.upload_file(
                path_or_fileobj=full_path,
                path_in_repo=fname,   # preserves subdirectory structure on HF
                repo_id=REPO_ID,
                repo_type="space",
                token=TOKEN
            )
            print(f"  [OK] Uploaded: {fname}")
        except Exception as e:
            print(f"  [ERR] Failed to upload {fname}: {e}")
    else:
        print(f"  [WARN] File not found, skipping: {fname}")

print("\n" + "="*52)
print("HUGGING FACE SPACE DEPLOYMENT COMPLETE!")
print("="*52)
print(f"Space Repo: https://huggingface.co/spaces/{REPO_ID}")
print(f"App URL   : https://kutty-35-zenitsu-live-bot.hf.space")
print("="*52)
