import os
import sys
from huggingface_hub import HfApi

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

env_vars = load_env('.env')

token = env_vars.get('HF_TOKEN')
repo_id = 'kutty-35/zenitsu-live-bot'

if not token:
    print('ERROR: HF_TOKEN not found in .env')
    sys.exit(1)

api = HfApi(token=token)

gemini_key = env_vars.get('GEMINI_API_KEY')
groq_key   = env_vars.get('GROQ_API_KEY')
openai_key = env_vars.get('OPENAI_API_KEY')

if not gemini_key or not groq_key or not openai_key:
    print('ERROR: GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY missing from .env')
    sys.exit(1)

api.add_space_secret(repo_id=repo_id, key='GEMINI_API_KEY', value=gemini_key)
print('[OK] GEMINI_API_KEY updated on Hugging Face')

api.add_space_secret(repo_id=repo_id, key='GROQ_API_KEY', value=groq_key)
print('[OK] GROQ_API_KEY updated on Hugging Face')

api.add_space_secret(repo_id=repo_id, key='OPENAI_API_KEY', value=openai_key)
print('[OK] OPENAI_API_KEY updated on Hugging Face')

print('\nDone! HF Space will restart with new keys.')
