export type InstallEnvInput = {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  /** iOS's `navigator.standalone`, true when launched from the Home Screen. */
  readonly navigatorStandalone: boolean;
  /** The `(display-mode: standalone)` media query, which other browsers use. */
  readonly displayModeStandalone: boolean;
};

export type InstallEnv = { readonly ios: boolean; readonly standalone: boolean };

export function installEnvParse(input: InstallEnvInput): InstallEnv {
  // iPadOS sends a Mac user agent by default, and `navigator.platform` (deprecated) still reads "MacIntel" there. Touch support is the only tell between that iPad and a Mac.
  const ipadAsMac = input.platform === 'MacIntel' && input.maxTouchPoints > 1;
  return { ios: /iPhone|iPad|iPod/.test(input.userAgent) || ipadAsMac, standalone: input.navigatorStandalone || input.displayModeStandalone };
}
