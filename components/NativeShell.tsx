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
  // Face ID's system prompt itself fires appStateChange events (inactive
  // while the prompt shows, active when it dismisses). These refs mirror
  // state so the listener — registered once — can tell a genuine
  // background/foreground transition from the prompt's own lifecycle;
  // without them every unlock re-triggered the prompt in a loop.
  const authenticatingRef = useRef(false);
  const lockedRef = useRef(false);
  const authFailedRef = useRef(false);

  const setLockedState = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);

  const setAuthFailedState = useCallback((value: boolean) => {
    authFailedRef.current = value;
    setAuthFailed(value);
  }, []);

  const authenticate = useCallback(async () => {
    if (authenticatingRef.current) return;
    authenticatingRef.current = true;
    setAuthFailedState(false);
    try {
      const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
      const { isAvailable } = await BiometricAuth.checkBiometry();
      if (!isAvailable) {
        // No biometrics and no passcode enrolled — don't brick the app.
        setLockedState(false);
        return;
      }
      await BiometricAuth.authenticate({
        reason: 'Unlock Training Hub',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Use passcode',
        cancelTitle: 'Cancel',
      });
      setLockedState(false);
    } catch {
      setAuthFailedState(true);
    } finally {
      authenticatingRef.current = false;
    }
  }, [setLockedState, setAuthFailedState]);

  useEffect(() => {
    if (!isNative()) return;
    setNative(true);
    setLockedState(true);

    // Tag the document so CSS can offset content below the status bar.
    // The Capacitor webview draws under the notch (contentInset: 'never'),
    // and unlike an installed PWA it doesn't report display-mode:standalone,
    // so safe-area CSS needs its own hook.
    document.documentElement.classList.add('native-app');

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
        // Ignore the transitions caused by the Face ID prompt itself.
        if (authenticatingRef.current) return;
        if (!isActive) {
          setLockedState(true);
          setAuthFailedState(false);
        } else if (lockedRef.current && !authFailedRef.current) {
          // Re-prompt only when still locked from a real backgrounding.
          // After a cancelled/failed attempt (authFailed), wait for the
          // user to tap the unlock button instead of re-prompting — the
          // prompt's own dismissal also lands here and would loop.
          void authenticate();
        }
      });
      removeListener = () => void handle.remove();

      void authenticate();
    })();

    return () => removeListener?.();
  }, [authenticate, setLockedState, setAuthFailedState]);

  if (!native || !locked) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="Training Hub" className="h-20 w-20 rounded-2xl" />
      <p className="text-sm text-ink-3">Locked</p>
      {authFailed && (
        <button
          onClick={() => void authenticate()}
          className="rounded-full bg-accent px-8 py-3 font-semibold text-page"
        >
          Unlock with Face ID
        </button>
      )}
    </div>
  );
}
