import Capacitor
import UIKit

/// The app's bridge view controller, which exists solely to register
/// AppIconPlugin.
///
/// Capacitor does not auto-discover plugins that live in the app target. It
/// builds its registry from `packageClassList` in capacitor.config.json, and
/// `npx cap sync` generates that list from the installed npm packages — so a
/// plugin defined here is simply absent from it. `registerPlugin('AppIcon')`
/// on the JS side then resolves to a web stub and every call quietly does
/// nothing, which is exactly how the icon picker looked: the profile saved,
/// the in-app logo changed, and the home screen never moved.
///
/// `registerPluginInstance` in `capacitorDidLoad` is the supported hook for
/// app-local plugins. Deliberately not an entry added by hand to
/// packageClassList: the next `cap sync` would regenerate that file and drop
/// it again, silently breaking the picker a second time.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppIconPlugin())
    }
}
