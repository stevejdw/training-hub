#!/bin/sh
#
# Xcode Cloud runs this after the clone and before xcodebuild.
#
# The build number used to be a literal in project.pbxproj
# (CURRENT_PROJECT_VERSION), which meant every release needed a manual bump
# and every forgotten bump failed the same way: the archive built fine and
# then "Prepare Build for App Store Connect" rejected it with "the bundle
# version must be higher than the previously uploaded version".
#
# CI_BUILD_NUMBER is Xcode Cloud's own monotonically increasing build number,
# so deriving the bundle version from it can't collide or go backwards.
# BUILD_NUMBER_OFFSET exists for the case where a manually-uploaded build has
# already claimed a higher number than the CI counter has reached — raise it
# rather than editing the project.
#
# The offset is 10 because manual uploads left App Store Connect holding
# builds 1, 2, 3 and 4, uploaded out of order (4 on 2026-08-01, 3 on
# 2026-08-20). TestFlight orders by build number, not upload date, so build 4
# sat above the newer build 3 and the device was never offered it. Xcode
# Cloud's own counter starts low, so without the offset the next CI build
# could land at or below 4 and repeat exactly that.
set -e

BUILD_NUMBER_OFFSET=10

# Only Xcode Cloud sets CI_BUILD_NUMBER. Locally the project's own value
# stands, so an Xcode build from a laptop behaves as it always did.
if [ -z "$CI_BUILD_NUMBER" ]; then
  echo "CI_BUILD_NUMBER not set — leaving the bundle version alone."
  exit 0
fi

INFO_PLIST="$CI_PRIMARY_REPOSITORY_PATH/ios/App/App/Info.plist"
BUILD_NUMBER=$((CI_BUILD_NUMBER + BUILD_NUMBER_OFFSET))

# PlistBuddy rather than agvtool: CFBundleVersion here is the $(...)
# reference to CURRENT_PROJECT_VERSION, and overwriting it with the literal
# is all App Store Connect looks at. agvtool would also want
# VERSIONING_SYSTEM configured and would rewrite the pbxproj as a side
# effect. This edit lives only in the CI checkout.
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$INFO_PLIST"
echo "Bundle version set to $BUILD_NUMBER (CI_BUILD_NUMBER=$CI_BUILD_NUMBER, offset=$BUILD_NUMBER_OFFSET)."
