#!/bin/sh
#
# Xcode Cloud runs this after cloning the repo and before resolving Swift
# packages. CapApp-SPM/Package.swift references Capacitor plugins as local
# packages under node_modules (see capacitor.config.ts / `npx cap sync ios`),
# and node_modules is gitignored, so it doesn't exist in a fresh Xcode Cloud
# checkout without this install.
set -e

# CI_WORKSPACE is the repo root in Xcode Cloud.
cd "$CI_WORKSPACE"

# Xcode Cloud's macOS images ship Node via nvm/n, not on PATH by default.
if ! command -v npm >/dev/null 2>&1; then
  brew install node
fi

npm ci

# Regenerate the native Capacitor resources that the Xcode project bundles but
# that are gitignored (generated artifacts): ios/App/App/{config.xml,
# capacitor.config.json,public}. Without this they're absent in a fresh Xcode
# Cloud checkout and the Archive step fails with "no such file". `cap sync` also
# rewrites CapApp-SPM/Package.swift to match the installed plugin versions, so
# it must run before Xcode resolves Swift packages.
npx cap sync ios
