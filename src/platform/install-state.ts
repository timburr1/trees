import { installEnvParse, type InstallEnv } from '../lib/install-env.ts';

/** Reads the browser once. Nothing here changes while the page is open, so callers may keep the result. */
export function installStateGet(): InstallEnv {
  return installEnvParse({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    navigatorStandalone: Reflect.get(navigator, 'standalone') === true,
    displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
  });
}
