import { installNote } from './install-note.ts';

const browser = { ios: true, standalone: false };
const installed = { ios: true, standalone: true };

describe('installNote', () => {
  it('tells an iOS browser user with no sessions to install first', () => {
    expect(installNote(browser, 0)).toBe('install-first');
  });

  it('tells an installed iOS user with no sessions how to bring data over', () => {
    expect(installNote(installed, 0)).toBe('bring-data');
  });

  it('tells an iOS browser user with sessions that the installed app starts empty', () => {
    expect(installNote(browser, 1)).toBe('moving-data');
    expect(installNote(browser, 40)).toBe('moving-data');
  });

  it('says nothing to an installed iOS user who has sessions', () => {
    expect(installNote(installed, 1)).toBeUndefined();
  });

  it('says nothing off iOS, installed or not', () => {
    expect(installNote({ ios: false, standalone: false }, 0)).toBeUndefined();
    expect(installNote({ ios: false, standalone: true }, 0)).toBeUndefined();
    expect(installNote({ ios: false, standalone: false }, 3)).toBeUndefined();
  });
});
