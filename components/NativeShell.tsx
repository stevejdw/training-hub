'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

const isNative = () =>
  typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;

/**
 * Native-app integration, active only inside the Capacitor iOS shell:
 * - sets the status bar to light text over the dark theme
 * - locks the UI behind Face ID on launch and whenever the app returns
 *   from the background
 *
 * Renders nothing in a regular browser.
 */
export default function NativeShell() {
  const [native, setNative] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  // Face ID's system prompt fires appStateChange events; this guard stops
  // those from re-locking or re-triggering auth mid-prompt.
  const authenticatingRef = useRef(false);

  const authenticate = useCallback(async () => {
    if (authenticatingRef.current) return;
    authenticatingRef.current = true;
    setAuthFailed(false);
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      const { isAvailable } = await BiometricAuth.checkBiometry();
      if (!isAvailable) {
        // No biometrics and no passcode enrolled — don't brick the app.
        setLocked(false);
        return;
      }
      await BiometricAuth.authenticate({
        reason: 'Unlock Training Hub',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Use passcode',
        cancelTitle: 'Cancel',
      });
      setLocked(false);
    } catch {
      setAuthFailed(true);
    } finally {
      authenticatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    setNative(true);
    setLocked(true);

    let removeListener: (() => void) | undefined;

    (async () => {
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // Status bar styling is cosmetic — never block the app on it.
      }

      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appStateChange', ({ isActive }) => {
        if (authenticatingRef.current) return;
        if (!isActive) {
          setLocked(true);
          setAuthFailed(false);
        } else {
          void authenticate();
        }
      });
      removeListener = () => void handle.remove();

      void authenticate();
    })();

    return () => removeListener?.();
  }, [authenticate]);

  if (!native || !locked) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-gray-950">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="Training Hub" className="h-20 w-20 rounded-2xl" />
      <p className="text-sm text-gray-400">Locked</p>
      {authFailed && (
        <button
          onClick={() => void authenticate()}
          className="rounded-full bg-orange-500 px-8 py-3 font-semibold text-gray-950"
        >
          Unlock with Face ID
        </button>
      )}
    </div>
  );
}
