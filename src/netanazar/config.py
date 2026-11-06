import os
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", "unset@example.com")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
USER_AGENT = f"NetaNazarBot/1.0 (+contact: {CONTACT_EMAIL})"
