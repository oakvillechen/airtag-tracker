import os
import subprocess
import glob
import re
import requests
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

SCREENSHOT_DIR = "/Users/guodong.chen/Desktop/airtagTracker/screenshot"
PROCESSED_DIR = os.path.join(SCREENSHOT_DIR, "processed")
OCR_SCRIPT = os.path.join(os.path.dirname(__file__), "ocr.swift")

# Common device names we expect to see
DEVICES = ["Lucas’ Backpack AirTag", "Jolie’s scooter", "Keys", "Wallet"]

# Supabase Client
USER_ID = os.getenv('USER_ID')
if not USER_ID:
    print("❌ ERROR: USER_ID not found in environment variables.")
    print("Please add USER_ID to your scripts/.env file.")
    exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def run_ocr(image_path):
    """Runs the swift OCR script and returns the lines of text."""
    try:
        result = subprocess.run(['swift', OCR_SCRIPT, image_path], capture_output=True, text=True)
        if result.returncode != 0:
            print(f"❌ OCR Error: {result.stderr}")
            return []
        return [line.strip() for line in result.stdout.split('\n') if line.strip()]
    except Exception as e:
        print(f"❌ Error running OCR: {e}")
        return []

def normalize_text(text):
    """Normalizes text for comparison (lowercase, straight apostrophes)."""
    return text.lower().replace("’", "'").replace("•", ",").strip()

def clean_address(address):
    """Cleans up the extracted address by removing trailing OCR noise like ', b' or ', 4'."""
    # Split by comma and keep parts that don't look like single character noise
    parts = [p.strip() for p in address.split(',')]
    valid_parts = []
    for p in parts:
        if len(p) > 2 or p.lower() in ["rd", "st", "dr", "av"]:
            valid_parts.append(p)
    return ", ".join(valid_parts)

def parse_ocr_output(lines):
    """
    Parses the OCR lines to find device locations.
    """
    results = []
    normalized_lines = [normalize_text(l) for l in lines]
    
    # Common address markers in the target area
    ADDRESS_MARKERS = ["way", "rd", "ave", "dr", "st", "lane", "oakville", "toronto"]
    
    print(f"--- Parsing OCR ({len(lines)} lines) ---")
    
    for i, line in enumerate(normalized_lines):
        # Look for our specific devices
        for device in DEVICES:
            norm_device = normalize_text(device)
            if norm_device in line:
                print(f"🔍 Found device: {device} at line {i}")
                # The address is usually within the next 2 lines
                for offset in [1, 2]:
                    if i + offset < len(normalized_lines):
                        candidate = normalized_lines[i + offset]
                        # Check if it looks like an address
                        if any(marker in candidate for marker in ADDRESS_MARKERS) and "," in candidate:
                            final_address = clean_address(lines[i + offset].replace("•", ",").strip())
                            print(f"🎯 Match found: {device} -> {final_address}")
                            results.append({
                                'name': device,
                                'address': final_address
                            })
                            break
    return results

def geocode_address(address):
    """Geocodes an address using the Photon API."""
    try:
        # Using Toronto as the bias center
        url = f"https://photon.komoot.io/api/?q={requests.utils.quote(address)}&lat=43.6532&lon=-79.3832&limit=1"
        headers = {
            'User-Agent': 'AirtagTrackerSync/1.0 (chenguodong@gmail.com)'
        }
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get('features'):
                lng, lat = data['features'][0]['geometry']['coordinates']
                return lat, lng
        else:
            print(f"⚠️ Geocoding API returned status {response.status_code}")
    except Exception as e:
        print(f"⚠️ Geocoding failed for '{address}': {e}")
    return 0, 0

def sync_screenshot(file_path):
    print(f"📷 Processing: {os.path.basename(file_path)}")
    
    # Extract timestamp from filename: findmy_yyyy-mm-dd_hh-mm-ss.png
    filename = os.path.basename(file_path)
    match = re.search(r'findmy_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})', filename)
    if not match:
        print("❌ Could not parse timestamp from filename.")
        return False
    
    date_str, time_str = match.groups()
    # Toronto is UTC-5 (EST) or UTC-4 (EDT). For simplicity, we use -05:00 
    # as the user is in Toronto.
    timestamp_iso = f"{date_str}T{time_str.replace('-', ':')}-05:00"
    
    lines = run_ocr(file_path)
    if not lines:
        print("❌ No text extracted from screenshot.")
        return False
    
    found_locations = parse_ocr_output(lines)
    if not found_locations:
        print("⏩ No device locations found in screenshot sidebar.")
        return False

    success_count = 0

    for loc in found_locations:
        device_name = loc['name']
        address = loc['address']
        
        try:
            # Check if this location is different from the last one in DB
            existing = supabase.table('locations').select('*').eq(
                'device_name', device_name
            ).order('datetime', desc=True).limit(1).execute()
            
            should_sync = True
            if existing.data:
                last_entry = existing.data[0]
                if last_entry['address'] == address:
                    print(f"⏩ {device_name} is still at '{address}'. Skipping.")
                    should_sync = False
            
            if should_sync:
                print(f"🌐 Geocoding: {address}...")
                lat, lng = geocode_address(address)
                
                payload = {
                    'device_name': device_name,
                    'address': address,
                    'lat': lat,
                    'lng': lng,
                    'datetime': timestamp_iso,
                    'device_emoji': "🎒" if "Backpack" in device_name else "🛴" if "scooter" in device_name else "🏷️",
                    'user_id': os.getenv('USER_ID')
                }
                supabase.table('locations').insert(payload).execute()
                print(f"✅ Synced: {device_name} -> {address} ({lat}, {lng})")
                success_count += 1
                
        except Exception as e:
            print(f"❌ Error syncing {device_name}: {e}")

    return success_count > 0

def main():
    if not os.path.exists(PROCESSED_DIR):
        os.makedirs(PROCESSED_DIR)

    screenshots = glob.glob(os.path.join(SCREENSHOT_DIR, "findmy_*.png"))
    screenshots.sort()
    
    if not screenshots:
        print("📭 No new screenshots found.")
        return

    for screenshot in screenshots:
        success = sync_screenshot(screenshot)
        target_path = os.path.join(PROCESSED_DIR, os.path.basename(screenshot))
        if os.path.exists(target_path):
            os.remove(target_path)
        os.rename(screenshot, target_path)
        print(f"📦 Moved to processed.")

if __name__ == "__main__":
    main()
