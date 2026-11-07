import { installEnvParse, type InstallEnvInput } from './install-env.ts';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ipadClassic = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
// iPadOS 13 and later send a Mac user agent by default, so only touch support tells an iPad from a Mac.
const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const androidChrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

function env(overrides: Partial<InstallEnvInput>): InstallEnvInput {
  return { userAgent: macSafari, platform: 'MacIntel', maxTouchPoints: 0, navigatorStandalone: false, displayModeStandalone: false, ...overrides };
}

describe('installEnvParse', () => {
  it('recognizes an iPhone and an older iPad by their user agents', () => {
    expect(installEnvParse(env({ userAgent: iphone, platform: 'iPhone', maxTouchPoints: 5 })).ios).toBe(true);
    expect(installEnvParse(env({ userAgent: ipadClassic, platform: 'iPad', maxTouchPoints: 5 })).ios).toBe(true);
  });

  it('recognizes an iPad that sends a Mac user agent, by touch support', () => {
    expect(installEnvParse(env({ userAgent: macSafari, platform: 'MacIntel', maxTouchPoints: 5 })).ios).toBe(true);
  });

  it('does not take a Mac without touch, or Android, for iOS', () => {
    expect(installEnvParse(env({ userAgent: macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).ios).toBe(false);
    expect(installEnvParse(env({ userAgent: androidChrome, platform: 'Linux armv81', maxTouchPoints: 5 })).ios).toBe(false);
  });

  it('is standalone when either signal says so', () => {
    expect(installEnvParse(env({ navigatorStandalone: true })).standalone).toBe(true);
    expect(installEnvParse(env({ displayModeStandalone: true })).standalone).toBe(true);
    expect(installEnvParse(env({})).standalone).toBe(false);
  });

  it('reports the two answers independently', () => {
    expect(installEnvParse(env({ userAgent: iphone, platform: 'iPhone', maxTouchPoints: 5, navigatorStandalone: true }))).toEqual({
      ios: true,
      standalone: true,
    });
    expect(installEnvParse(env({ userAgent: androidChrome, platform: 'Linux armv81', maxTouchPoints: 5, displayModeStandalone: true }))).toEqual({
      ios: false,
      standalone: true,
    });
  });
});
