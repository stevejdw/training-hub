import Capacitor
import UIKit

/// Swaps the home-screen icon of the installed app.
///
/// The Settings icon picker used to write `app_icon` to the profile and stop
/// there, which only ever affected the web manifest / apple-touch-icon. Neither
/// reaches an installed native app: its icon comes from the compiled asset
/// catalogue, and the only supported way to change it at runtime is
/// `setAlternateIconName`. The alternates are declared in the App target's
/// ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES build setting and must stay in
/// step with ICON_NAMES below and with the picker in SettingsContent.tsx.
///
/// iOS shows its own "You have changed the icon for Training Hub" alert on a
/// successful change. That is system UI and cannot be suppressed.
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    /// Picker id -> asset catalogue icon set. `speed` is the primary icon, so
    /// it maps to nil: passing nil to setAlternateIconName restores AppIcon.
    private static let iconNames: [String: String?] = [
        "gear":       "AppIcon-gear",
        "minimalist": "AppIcon-minimalist",
        "path":       "AppIcon-path",
        "speed":      nil,
    ]

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let supported = UIApplication.shared.supportsAlternateIcons
            let current = UIApplication.shared.alternateIconName
            let id = Self.iconNames.first { $0.value == current }?.key ?? "speed"
            call.resolve(["supported": supported, "icon": id])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let id = call.getString("icon") else {
            call.reject("icon is required")
            return
        }
        // `iconNames[id]` is a double optional: the outer level is "unknown id",
        // the inner is "this id means the primary icon".
        guard let name = Self.iconNames[id] else {
            call.reject("Unknown icon '\(id)'")
            return
        }

        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.reject("Alternate icons are not supported on this device")
                return
            }
            // No-op rather than an error: re-selecting the active icon would
            // otherwise show the system alert again for no visible change.
            guard UIApplication.shared.alternateIconName != name else {
                call.resolve(["icon": id])
                return
            }
            UIApplication.shared.setAlternateIconName(name) { error in
                if let error {
                    call.reject("Could not set icon: \(error.localizedDescription)")
                } else {
                    call.resolve(["icon": id])
                }
            }
        }
    }
}
