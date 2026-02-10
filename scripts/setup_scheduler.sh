#!/bin/bash

# Configuration
PROJECT_DIR="/Users/guodong.chen/Desktop/airtagTracker"
SCRIPT_PATH="$PROJECT_DIR/scripts/findmy_sync.py"
PLIST_NAME="com.airtag.sync.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_PATH="$PROJECT_DIR/scripts/sync.log"

echo "⚙️ Setting up AirTag Sync Scheduler..."

# Ensure script is executable
chmod +x "$SCRIPT_PATH"

# Create the plist file
cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.airtag.sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which python3)</string>
        <string>$SCRIPT_PATH</string>
    </array>
    <key>StartInterval</key>
    <integer>900</integer> <!-- 900 seconds = 15 minutes -->
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$LOG_PATH</string>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
</dict>
</plist>
EOF

# Load the LaunchAgent
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "✅ Scheduler installed and loaded!"
echo "📍 Plist path: $PLIST_PATH"
echo "📝 Log path: $LOG_PATH"
echo "🔁 Syncing every 15 minutes."
echo ""
echo "⚠️  IMPORTANT: Ensure Terminal has 'Full Disk Access' in System Settings."
echo "   Privacy & Security > Full Disk Access > Toggle Terminal ON."
