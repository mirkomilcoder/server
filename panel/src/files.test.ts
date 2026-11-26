import { describe, expect, it } from 'vitest';
import { join, modeString, normalize, parent, parseFind } from './api/files';
import { actions } from './api/actions';
import { absPath, mutablePath } from './api/validate';

// Real `find -printf` output from the test VM (NUL-separated, 9 fields per entry).
const VM_LIST = [
  'l', 'N', '7', '1795721612.0996928910', '777', 'home-server', 'home-server', 'nowhere', 'broken',
  'l', 'd', '3', '1795721612.0956928630', '777', 'home-server', 'home-server', 'a b', 'link',
  'd', 'd', '60', '1795721612.0916928350', '775', 'home-server', 'home-server', '', 'a b',
  'f', 'f', '6', '1795721612.0922266280', '664', 'home-server', 'home-server', '', 'tab\tand\nnewline.txt',
].join('\0') + '\0';

describe('parseFind', () => {
  const list = parseFind(VM_LIST);
  it('reads every entry, including names with spaces, tabs and newlines', () => {
    expect(list.map((e) => e.name)).toEqual(['broken', 'link', 'a b', 'tab\tand\nnewline.txt']);
  });
  it('classifies symlinks by target', () => {
    expect(list[0]).toMatchObject({ type: 'link', target: 'broken', linkTo: 'nowhere' });
    expect(list[1]).toMatchObject({ type: 'link', target: 'dir', linkTo: 'a b' });
    expect(list[2]).toMatchObject({ type: 'dir', mode: '775', size: 60 });
  });
  it('keeps the relative path of search results', () => {
    const [e] = parseFind(['f', 'f', '6', '1', '664', 'u', 'g', '', 'a b/x.txt', ''].join('\0'));
    expect(e).toMatchObject({ name: 'x.txt', rel: 'a b/x.txt' });
  });
  it('ignores empty output', () => expect(parseFind('')).toEqual([]));
});

describe('paths', () => {
  it('normalises typed paths', () => {
    expect(normalize('~/projects/../bots/', '/home/u', '/')).toBe('/home/u/bots');
    expect(normalize('logs', '/home/u', '/var')).toBe('/var/logs');
    expect(normalize('/../..', '/home/u', '/')).toBe('/');
  });
  it('joins and finds parents', () => {
    expect(join('/', 'etc')).toBe('/etc');
    expect(parent('/etc/hosts')).toBe('/etc');
    expect(parent('/etc')).toBe('/');
  });
  it('accepts only normalised absolute paths', () => {
    for (const ok of ['/', '/home/u/a b', '/srv/кириллица.txt', '/x/-rf']) expect(absPath.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['', 'rel', '/a/', '/a//b', '/a/../b', '/a/./b', '/a\nb', '/a\u0000b']) expect(absPath.safeParse(bad).success, bad).toBe(false);
  });
  it('never lets destructive actions touch system roots', () => {
    for (const p of ['/', '/etc', '/home', '/usr', '/var/lib']) expect(mutablePath.safeParse(p).success, p).toBe(false);
    expect(mutablePath.safeParse('/home/u/old').success).toBe(true);
  });
  it('formats permissions', () => expect(modeString('754')).toBe('rwxr-xr--'));
});

describe('file actions argv', () => {
  const ctx = { user: { id: 1000, name: 'u', full_name: 'u', home: '/home/u' } };
  it('puts user paths after "--" or a target flag', () => {
    const del = actions['files.delete'];
    expect(del.argv(del.schema.parse({ paths: ['/home/u/-rf'] }), ctx)).toEqual(['rm', '-rf', '--one-file-system', '--preserve-root=all', '--', '/home/u/-rf']);
    const mv = actions['files.rename'];
    expect(mv.argv(mv.schema.parse({ from: '/home/u/a', to: '/home/u/b' }), ctx)).toEqual(['mv', '--update=none-fail', '-T', '--', '/home/u/a', '/home/u/b']);
  });
  it('escapes glob characters in search', () => {
    const s = actions['files.search'];
    const argv = s.argv(s.schema.parse({ path: '/srv', q: 'a*b?[c]' }), ctx);
    expect(argv[argv.indexOf('-iname') + 1]).toBe('*a\\*b\\?\\[c\\]*');
  });
  it('refuses deleting a system root even if asked', () => {
    expect(actions['files.delete'].schema.safeParse({ paths: ['/etc'] }).success).toBe(false);
  });
});
