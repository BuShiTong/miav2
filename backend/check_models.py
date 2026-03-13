"""Quick script to list available native audio models on AI Studio."""
from google import genai

# Paste your AI Studio API key here:
API_KEY = "PASTE_YOUR_KEY_HERE"

client = genai.Client(api_key=API_KEY)

print("Looking for native audio models...\n")
found = False
for m in client.models.list():
    if "native-audio" in m.name.lower():
        tag = " ← PREVIEW" if "preview" in m.name.lower() else " ← GA (stable)"
        print(f"  {m.name}{tag}")
        found = True

if not found:
    print("  No native audio models found. Listing ALL models with 'audio' in name:\n")
    for m in client.models.list():
        if "audio" in m.name.lower():
            print(f"  {m.name}")

print("\nDone.")
