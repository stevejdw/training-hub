#!/usr/bin/env bash
#
# Build and upload a TestFlight build of Training Hub.
#
# The iOS app is a Capacitor shell around the Vercel-hosted web app, so a new
# build is only needed when something native changes (plugins, Info.plist,
# icons, the Capacitor config). Web-only changes reach the phone on their own
# via the remote server.url — you do NOT need to ship a build for those.
#
# Usage:
#   ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#     scripts/ship-ios.sh
#
#   scripts/ship-ios.sh --build-only    # archive + export, skip the upload
#
# Requires the App Store Connect API key (.p8) at:
#   ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$REPO_ROOT/ios/App"
PBXPROJ="$IOS_DIR/App.xcodeproj/project.pbxproj"
BUILD_DIR="$(mktemp -d -t traininghub-ios)"
ARCHIVE="$BUILD_DIR/TrainingHub.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
TEAM_ID="6AYBTL8574"

BUILD_ONLY=false
[[ "${1:-}" == "--build-only" ]] && BUILD_ONLY=true

if [[ "$BUILD_ONLY" == false ]]; then
  : "${ASC_KEY_ID:?Set ASC_KEY_ID (App Store Connect API Key ID)}"
  : "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID (App Store Connect Issuer ID)}"
  KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
  if [[ ! -f "$KEY_PATH" ]]; then
    echo "error: API key not found at $KEY_PATH" >&2
    echo "Download it from App Store Connect > Users and Access > Integrations." >&2
    exit 1
  fi
fi

# Every upload needs a build number App Store Connect has not seen before;
# reusing one is rejected outright. Bump it before archiving.
CURRENT_BUILD="$(grep -m1 -E 'CURRENT_PROJECT_VERSION = [0-9]+;' "$PBXPROJ" | grep -oE '[0-9]+')"
NEXT_BUILD=$((CURRENT_BUILD + 1))
echo "==> Build number $CURRENT_BUILD -> $NEXT_BUILD"
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = ${NEXT_BUILD};/g" "$PBXPROJ"

echo "==> Syncing Capacitor"
( cd "$REPO_ROOT" && npx cap sync ios )

echo "==> Archiving"
xcodebuild -project "$IOS_DIR/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  archive

cat > "$BUILD_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>${TEAM_ID}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>uploadSymbols</key>
	<true/>
	<key>destination</key>
	<string>export</string>
</dict>
</plist>
PLIST

echo "==> Exporting"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -allowProvisioningUpdates

IPA="$EXPORT_DIR/App.ipa"

if [[ "$BUILD_ONLY" == true ]]; then
  echo "==> Built (not uploaded): $IPA"
  exit 0
fi

echo "==> Uploading build $NEXT_BUILD to TestFlight"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"

echo "==> Uploaded. Processing usually takes 5-15 minutes before the build"
echo "    appears in TestFlight."
