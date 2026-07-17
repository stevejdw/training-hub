import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'au.com.dewit.traininghub',
  appName: 'Training Hub',
  // The app is served remotely from Vercel (server.url below); webDir only
  // holds the local offline fallback assets.
  webDir: 'capacitor/www',
  server: {
    url: 'https://training-hub-gamma.vercel.app',
    // Shown when the remote app fails to load (no connectivity).
    errorPath: 'error.html',
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#030712',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#030712',
      showSpinner: false,
    },
  },
};

export default config;
