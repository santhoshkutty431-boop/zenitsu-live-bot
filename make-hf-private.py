import os
import sys
from huggingface_hub import HfApi

TOKEN = os.environ.get("HF_TOKEN")
REPO_ID = "kutty-35/zenitsu-live-bot"

if not TOKEN:
    print("[ERR] HF_TOKEN is required.")
    sys.exit(1)

api = HfApi()

try:
    print(f"[..] Updating Space visibility to PRIVATE: {REPO_ID}...")
    api.update_repo_settings(
        repo_id=REPO_ID,
        private=True,
        repo_type="space",
        token=TOKEN
    )
    print("[OK] Space visibility updated to PRIVATE successfully!")
    
    # Trigger a rebuild to apply changes
    print("[..] Triggering a restart/rebuild of the Space...")
    api.restart_space(
        repo_id=REPO_ID,
        token=TOKEN
    )
    print("[OK] Space restart triggered.")
except Exception as e:
    print(f"[ERR] Failed: {e}")
    sys.exit(1)
