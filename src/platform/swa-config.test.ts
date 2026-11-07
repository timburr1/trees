import configText from '../../public/staticwebapp.config.json?raw';

// Only the keys are used, so nothing is loaded. One level of directories is enough: the config's exclusions are by directory.
const publicFiles = Object.keys(import.meta.glob('../../public/*'));
const publicDirFiles = Object.keys(import.meta.glob('../../public/*/*'));
const configName = 'staticwebapp.config.json';

// A pattern matches a path when `*` stands for any run of characters inside one path segment and `{a,b}` is an alternation, which is what the SWA docs show.
// This is this project's model of the glob; the docs do not say how `*` in the middle of a file name behaves, so the deployed site is the real check.
function patternMatches(pattern: string, path: string): boolean {
  const source = pattern
    .split(/(\*|\{[^}]*\})/)
    .map((part) => {
      if (part === '*') {
        return '[^/]*';
      }
      if (part.startsWith('{')) {
        return `(?:${part
          .slice(1, -1)
          .split(',')
          .map((option) => option.replace(/[.+?^$()|[\]\\]/g, '\\$&'))
          .join('|')})`;
      }
      return part.replace(/[.+?^$()|[\]\\{}]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(path);
}

function excludesRead(): readonly string[] {
  const parsed: unknown = JSON.parse(configText);
  const fallback: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'navigationFallback') : undefined;
  const exclude: unknown = typeof fallback === 'object' && fallback !== null ? Reflect.get(fallback, 'exclude') : undefined;
  if (!Array.isArray(exclude) || !exclude.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error(`${configName} needs navigationFallback.exclude as a list of strings`);
  }
  return exclude;
}

describe('patternMatches', () => {
  it('matches a literal path only exactly', () => {
    expect(patternMatches('/sw.js', '/sw.js')).toBe(true);
    expect(patternMatches('/sw.js', '/swXjs')).toBe(false);
    expect(patternMatches('/sw.js', '/sw.js.map')).toBe(false);
  });

  it('lets * stand for a run inside one segment, including mid-name', () => {
    expect(patternMatches('/workbox-*.js', '/workbox-abc123.js')).toBe(true);
    expect(patternMatches('/workbox-*.js', '/workbox-abc123.css')).toBe(false);
    expect(patternMatches('/workbox-*.js', '/workbox/abc.js')).toBe(false);
    expect(patternMatches('/icons/*', '/icons/icon-512.png')).toBe(true);
    expect(patternMatches('/icons/*', '/icons2/icon-512.png')).toBe(false);
  });

  it('supports brace alternation', () => {
    expect(patternMatches('/images/*.{png,jpg}', '/images/a.png')).toBe(true);
    expect(patternMatches('/images/*.{png,jpg}', '/images/a.svg')).toBe(false);
  });
});

describe('navigationFallback.exclude', () => {
  const exclude = excludesRead();
  const covered = (path: string) => exclude.some((pattern) => patternMatches(pattern, path));

  // A request for a file that does not exist would otherwise be answered with the app shell, which a browser then rejects as a script or a manifest.
  it('covers every root-level entry of public/ except the config itself', () => {
    const names = (list: readonly string[]) => list.map((path) => path.slice('../../public/'.length));
    const directories = new Set(names(publicDirFiles).map((name) => name.split('/')[0]));
    const paths = [
      ...names(publicFiles)
        .filter((name) => name !== configName)
        .map((name) => `/${name}`),
      ...[...directories].map((name) => `/${name}/file`),
    ];
    expect(paths.filter((path) => !covered(path))).toEqual([]);
  });

  it('covers the files the build generates at the root', () => {
    const generated = ['/sw.js', '/manifest.webmanifest', '/workbox-abc123.js'];
    expect(generated.filter((path) => !covered(path))).toEqual([]);
  });

  it('covers the bundled assets', () => {
    expect(covered('/assets/index-abc123.js')).toBe(true);
  });
});
