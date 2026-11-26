/*
 * DEV ONLY — in-memory filesystem behind the mock's find/mkdir/mv/cp/rm and
 * file channels, so the file manager can be previewed with `npm run dev`.
 */

interface Node {
  dir: boolean;
  data: string;
  mtime: number;
  mode: string;
  owner: string;
}

const now = () => Date.now() / 1000;
const fs = new Map<string, Node>();
const d = (p: string, owner = 'home-server', mode = '755') => fs.set(p, { dir: true, data: '', mtime: now() - Math.random() * 9e5, mode, owner });
const f = (p: string, data: string, owner = 'home-server', mode = '644') => fs.set(p, { dir: false, data, mtime: now() - Math.random() * 9e5, mode, owner });

for (const p of ['/', '/home', '/etc', '/opt', '/srv', '/var', '/var/log', '/tmp', '/usr']) d(p, 'root');
d('/home/home-server');
d('/home/home-server/projects');
d('/home/home-server/projects/milano-kafe');
f('/home/home-server/projects/milano-kafe/README.md', '# Milano kafe\n\nDjango sayti.\n');
f('/home/home-server/projects/milano-kafe/requirements.txt', 'Django==5.1.4\ngunicorn==23.0.0\n');
f('/home/home-server/projects/milano-kafe/manage.py', '#!/usr/bin/env python\nimport os, sys\n', 'home-server', '755');
d('/home/home-server/bots');
f('/home/home-server/bots/kino_bot.py', 'import asyncio\n\nasync def main():\n    print("bot ishga tushdi")\n\nasyncio.run(main())\n');
f('/home/home-server/bots/.env', 'BOT_TOKEN=***\n', 'home-server', '600');
d('/home/home-server/backups');
f('/home/home-server/backups/db-2026-11-20.tar.gz', 'x'.repeat(48_000_000 / 1000));
f('/home/home-server/notes.txt', 'Server eslatmalari\n- Har oy yangilash\n');
f('/home/home-server/photo.png', '');
f('/home/home-server/.bashrc', '# ~/.bashrc\nexport PATH=$PATH:~/bin\n');
f('/etc/hostname', 'home-server\n', 'root');
f('/etc/hosts', '127.0.0.1 localhost\n', 'root');
d('/etc/mirkomil', 'root', '750');
f('/etc/mirkomil/config.env', 'MK_DOMAIN="mirkomil-host.uz"\n', 'root', '640');
d('/opt/mirkomil', 'root');
d('/srv/www', 'root');
f('/srv/www/index.html', '<h1>Mirkomil Host</h1>\n', 'root');
f('/var/log/syslog', 'Nov 27 10:00:01 home-server CRON[123]: (root) CMD (true)\n', 'root', '640');

const parentOf = (p: string) => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));
const children = (p: string) => [...fs.keys()].filter((k) => k !== '/' && parentOf(k) === p);
const fail = (msg: string) => Promise.reject({ message: msg, problem: null, exit_status: 1, exit_signal: null });
const allowed = (p: string, write: boolean, admin: boolean) => {
  if (admin) return true;
  const n = fs.get(p);
  if (!n) return true;
  return n.owner === 'home-server' || (!write && n.mode[n.mode.length - 1] >= '4');
};

function entry(p: string, rel: string): string {
  const n = fs.get(p)!;
  const size = n.dir ? 4096 : n.data.length * (p.endsWith('.tar.gz') ? 1000 : 1);
  return [n.dir ? 'd' : 'f', n.dir ? 'd' : 'f', size, n.mtime.toFixed(4), n.mode, n.owner, n.owner, '', rel, ''].join('\0');
}

function copyTree(from: string, to: string) {
  for (const k of [...fs.keys()].filter((k) => k === from || k.startsWith(from + '/'))) {
    fs.set(to + k.slice(from.length), { ...fs.get(k)!, mtime: now() });
  }
}

function removeTree(p: string) {
  for (const k of [...fs.keys()]) if (k === p || k.startsWith(p + '/')) fs.delete(k);
}

/** Returns null when argv isn't a file-manager command. */
export function fsSpawn(argv: string[], admin: boolean): Promise<string> | null {
  const [cmd, ...a] = argv;
  const rest = (flag = '--') => a.slice(a.indexOf(flag) + 1);
  if (cmd === 'find') {
    const base = a[0];
    if (!fs.get(base)?.dir) return fail(`find: '${base}': No such file or directory`);
    if (!allowed(base, false, admin)) return fail(`find: '${base}': Permission denied`);
    const q = a.includes('-iname') ? a[a.indexOf('-iname') + 1].replace(/\*/g, '').replace(/\\/g, '').toLowerCase() : null;
    const keys = q === null ? children(base) : [...fs.keys()].filter((k) => k.startsWith(base === '/' ? '/' : base + '/') && k !== base && k.split('/').pop()!.toLowerCase().includes(q));
    return Promise.resolve(keys.map((k) => entry(k, q === null ? k.split('/').pop()! : k.slice(base.length + 1))).join(''));
  }
  if (cmd === 'mkdir' || cmd === 'touch') {
    const p = rest()[0];
    if (fs.has(p)) return cmd === 'touch' ? Promise.resolve('') : fail(`mkdir: cannot create directory '${p}': File exists`);
    if (!allowed(parentOf(p), true, admin)) return fail(`${cmd}: cannot create '${p}': Permission denied`);
    if (cmd === 'mkdir') d(p);
    else f(p, '');
    return Promise.resolve('');
  }
  if (cmd === 'mv' || cmd === 'cp') {
    const pairs: [string, string][] = a.includes('-T') ? [[rest()[0], rest()[1]]] : rest().map((s) => [s, `${a[a.indexOf('-t') + 1]}/${s.split('/').pop()}`]);
    for (const [from, to] of pairs) {
      if (!fs.has(from)) return fail(`${cmd}: cannot stat '${from}': No such file or directory`);
      if (fs.has(to)) return fail(`${cmd}: not replacing '${to}'`); // --update=none-fail
      if (!allowed(parentOf(to), true, admin)) return fail(`${cmd}: cannot create '${to}': Permission denied`);
      copyTree(from, to);
      if (cmd === 'mv') removeTree(from);
    }
    return Promise.resolve('');
  }
  if (cmd === 'rm') {
    for (const p of rest()) {
      if (!allowed(parentOf(p), true, admin)) return fail(`rm: cannot remove '${p}': Permission denied`);
      removeTree(p);
    }
    return Promise.resolve('');
  }
  if (cmd === 'chmod') {
    for (const p of rest()) fs.get(p) && (fs.get(p)!.mode = a[0]);
    return Promise.resolve('');
  }
  if (cmd === 'du') {
    const p = rest()[0];
    const total = [...fs.entries()].filter(([k]) => k.startsWith(p)).reduce((s, [, n]) => s + n.data.length, 0);
    return Promise.resolve(`${total}\t${p}\n`);
  }
  if (cmd === 'tar' && a[0] === '-czf') {
    f(a[1], 'archive');
    return Promise.resolve('');
  }
  if (cmd === 'tar' || cmd === 'python3') return Promise.resolve('');
  return null;
}

export function fsRead(path: string): string | null {
  const n = fs.get(path);
  return n && !n.dir ? n.data : null;
}

export function fsWrite(path: string, data: string | null) {
  if (data === null) fs.delete(path);
  else f(path, data);
}
