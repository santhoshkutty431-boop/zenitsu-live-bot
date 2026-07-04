import os
import sys
sys.stdout.reconfigure(encoding='utf-8')
from huggingface_hub import HfApi

TOKEN = os.environ.get("HF_TOKEN")
REPO_ID = "kutty-35/zenitsu-live-bot"

if not TOKEN:
    print("Error: HF_TOKEN is required.")
    sys.exit(1)

api = HfApi()

try:
    print("Fetching Space logs...")
    logs = api.get_space_runtime(
        repo_id=REPO_ID,
        token=TOKEN
    )
    print("Stage:", logs.stage)
    print("Hardware:", logs.hardware)
    # Get direct logs if possible
    raw_logs = api.fetch_space_logs(
        repo_id=REPO_ID,
        token=TOKEN
    )
    print("\n--- Logs ---")
    for log_line in raw_logs:
        # Check if log_line is a dict or object and has a message
        if hasattr(log_line, 'line'):
            print(log_line.line)
        else:
            print(log_line)
except Exception as e:
    print("Error:", e)
