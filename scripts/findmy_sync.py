#!/usr/bin/env python3
import os
import json
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

# Mapping for common AirTag names to emojis
EMOJI_MAP = {
    "backpack": "🎒",
    "keys": "🔑",
    "wallet": "👛",
    "scooter": "🛴",
    "bike": "🚲",
    "car": "🚗",
    "luggage": "🧳",
    "dog": "🐕",
    "cat": "🐈"
}

def get_emoji(name):
    name_lower = name.lower()
    for key, emoji in EMOJI_MAP.items():
        if key in name_lower:
            return emoji
    return "🏷️"

def get_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def get_findmy_items():
    """
    Reads the Find My Items.data file which is a JSON-like property list.
    Note: Requires Full Disk Access for the terminal/python process.
    """
    # Common path for Find My items data on modern macOS
    paths = [
        os.path.expanduser("~/Library/Caches/com.apple.findmy.itemsproxy/Items.data"),
        os.path.expanduser("~/Library/Containers/com.apple.findmy/Data/Library/Caches/com.apple.findmy.itemsproxy/Items.data")
    ]
    
    items_path = None
    for p in paths:
        if os.path.exists(p):
            items_path = p
            break
            
    if not items_path:
        print(f"❌ Error: Could not find Items.data")
        print("💡 Suggestion: Open Find My app and ensure AirTags are visible.")
        return []

    try:
        with open(items_path, 'r') as f:
            data = json.load(f)
            return data
    except PermissionError:
        print("❌ Error: Permission denied reading Items.data.")
        print("💡 Action: Please grant 'Full Disk Access' to Terminal in Privacy & Security.")
        return []
    except Exception as e:
        print(f"❌ Error reading Items.data: {e}")
        return []

def sync_items():
    print(f"[{datetime.now().isoformat()}] Starting Sync...")
    
    items = get_findmy_items()
    if not items:
        return

    supabase = get_supabase_client()
    synced_count = 0

    for item in items:
        name = item.get('name', 'Unknown Item')
        location = item.get('location', {})
        
        if not location:
            print(f"⏩ Skipping {name} - No location data.")
            continue

        lat = location.get('latitude')
        lng = location.get('longitude')
        timestamp_ms = location.get('timeStamp', 0)
        
        # Convert Apple timestamp (ms) to ISO string
        dt = datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc)
        iso_time = dt.isoformat()

        try:
            existing = supabase.table('locations').select('*').eq(
                'device_name', name
            ).order('datetime', desc=True).limit(1).execute()

            if existing.data:
                last_entry = existing.data[0]
                last_time = datetime.fromisoformat(last_entry['datetime'].replace('Z', '+00:00'))
                
                if dt <= last_time:
                    print(f"⏩ Skipping {name} - No new data since {last_time.isoformat()}")
                    continue

            payload = {
                'device_name': name,
                'device_emoji': get_emoji(name),
                'lat': lat,
                'lng': lng,
                'datetime': iso_time,
                'address': f"Auto-synced: {name}"
            }

            supabase.table('locations').insert(payload).execute()
            print(f"✅ Synced: {name} at {iso_time}")
            synced_count += 1

        except Exception as e:
            print(f"❌ Error syncing {name}: {e}")

    print(f"🏁 Sync finished. {synced_count} items updated.")

if __name__ == "__main__":
    sync_items()
