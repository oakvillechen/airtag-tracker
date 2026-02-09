#!/usr/bin/env python3
"""
AirTag Location Sync Script
Fetches AirTag locations from iCloud Find My and syncs to Supabase.
"""

import os
import sys
from datetime import datetime
from pyicloud import PyiCloudService
from supabase import create_client, Client

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
APPLE_ID = os.getenv('APPLE_ID')
APPLE_PASSWORD = os.getenv('APPLE_PASSWORD')

def get_supabase_client() -> Client:
    """Initialize Supabase client."""
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def authenticate_icloud():
    """Authenticate with iCloud and handle 2FA if needed."""
    api = PyiCloudService(APPLE_ID, APPLE_PASSWORD)
    
    if api.requires_2fa:
        print("Two-factor authentication required.")
        code = input("Enter the code you received on your trusted device: ")
        result = api.validate_2fa_code(code)
        if not result:
            print("Failed to verify 2FA code.")
            sys.exit(1)
        
        if not api.is_trusted_session:
            print("Session is not trusted. Requesting trust...")
            result = api.trust_session()
            if not result:
                print("Failed to trust session.")
    
    return api

def fetch_airtag_locations(api):
    """Fetch all AirTag/Find My item locations."""
    locations = []
    
    # Get Find My items (AirTags and other items)
    try:
        items = api.devices
        for device in items:
            location = device.location()
            if location:
                locations.append({
                    'name': device.get('name', 'Unknown'),
                    'lat': location.get('latitude'),
                    'lng': location.get('longitude'),
                    'datetime': datetime.now().isoformat(),
                    'address': f"{device.get('name', 'Unknown')} - Auto synced",
                    'device_id': device.get('id', ''),
                })
    except Exception as e:
        print(f"Error fetching devices: {e}")
    
    return locations

def sync_to_supabase(locations):
    """Sync fetched locations to Supabase."""
    supabase = get_supabase_client()
    
    for loc in locations:
        try:
            # Check if we already have a recent entry for this device
            existing = supabase.table('locations').select('*').eq(
                'address', loc['address']
            ).order('datetime', desc=True).limit(1).execute()
            
            # Only insert if no recent duplicate (within last 5 minutes)
            should_insert = True
            if existing.data:
                last_time = datetime.fromisoformat(existing.data[0]['datetime'].replace('Z', '+00:00'))
                now = datetime.now().astimezone()
                diff = (now - last_time).total_seconds()
                if diff < 300:  # 5 minutes
                    print(f"Skipping {loc['name']} - already synced recently")
                    should_insert = False
            
            if should_insert:
                result = supabase.table('locations').insert({
                    'address': loc['address'],
                    'lat': loc['lat'],
                    'lng': loc['lng'],
                    'datetime': loc['datetime']
                }).execute()
                print(f"Synced: {loc['name']} at ({loc['lat']}, {loc['lng']})")
        
        except Exception as e:
            print(f"Error syncing {loc['name']}: {e}")

def main():
    print("🏷️ AirTag Sync Script")
    print("=" * 40)
    
    # Validate environment
    if not all([SUPABASE_URL, SUPABASE_KEY, APPLE_ID, APPLE_PASSWORD]):
        print("Error: Missing environment variables.")
        print("Required: SUPABASE_URL, SUPABASE_KEY, APPLE_ID, APPLE_PASSWORD")
        sys.exit(1)
    
    # Authenticate
    print("Authenticating with iCloud...")
    api = authenticate_icloud()
    print("✓ Authenticated")
    
    # Fetch locations
    print("Fetching AirTag locations...")
    locations = fetch_airtag_locations(api)
    print(f"✓ Found {len(locations)} device(s)")
    
    # Sync to Supabase
    if locations:
        print("Syncing to Supabase...")
        sync_to_supabase(locations)
        print("✓ Sync complete")
    else:
        print("No locations to sync")

if __name__ == "__main__":
    main()
