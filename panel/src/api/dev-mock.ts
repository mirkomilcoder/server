import { fsRead, fsSpawn, fsWrite } from './dev-fs';
import type {
  Cockpit,
  CockpitChannel,
  CockpitChannelControl,
  CockpitFile,
  CockpitFileOptions,
  CockpitLocation,
  CockpitPermission,
  CockpitProcess,
  CockpitSpawnOptions,
} from './cockpit-types';

/*
 * DEV ONLY — a tiny fake cockpit.js so `npm run dev` renders in a normal
 * browser. Never shipped: cockpit.ts imports it only when import.meta.env.DEV.
 */

const NL = '\n';
const bootedAt =Date.now() - (12 * 86400 + 4 * 3600) * 1000;

const fakeFiles: Record<string, string> = {
  '/etc/hostname': 'home-server\n',
};

function makeProcess(result: Promise<string>): CockpitProcess {
  const p = result as CockpitProcess;
  p.stream = () => p;
  p.input = () => p;
  p.close = () => {};
  return p;
}

function spawn(argv: string[], opts?: CockpitSpawnOptions): CockpitProcess {
  const cmd = argv.join(' ');
  const fsResult = fsSpawn(argv, opts?.superuser === 'require');
  if (fsResult) return makeProcess(fsResult);
  if (cmd === 'cat /proc/uptime') {
    const s = (Date.now() - bootedAt) / 1000;
    return makeProcess(Promise.resolve(`${s.toFixed(2)} ${(s * 3.1).toFixed(2)}\n`));
  }
  if (argv[0] === 'cat' && argv[1] === '/proc/stat') return makeProcess(Promise.resolve(fakeProc()));
  if (argv[0] === 'df') {
    const size = 240e9, used = 98e9;
    return makeProcess(Promise.resolve(['1B-blocks Used Avail', `${size} ${used} ${size - used}`, ''].join(NL)));
  }
  if (argv[0] === 'systemctl' && argv[1] === 'show') {
    const units = argv.slice(argv.indexOf('--') + 1);
    const block = (u: string) => [`Id=${u}`, 'LoadState=loaded', 'ActiveState=active', 'SubState=running'].join(NL);
    return makeProcess(Promise.resolve(units.map(block).join(NL + NL) + NL));
  }
  if (argv[0] === 'journalctl') return fakeJournal();
  if (argv[0] === 'mkdir' || argv[0] === 'logger') {
    if (argv[0] === 'logger') console.info('[mock audit]', argv.at(-1));
    return makeProcess(Promise.resolve(''));
  }
  return makeProcess(
    Promise.reject({ message: `mock: not implemented: ${cmd}`, problem: 'not-found', exit_status: null, exit_signal: null }),
  );
}

// Monotonic fake counters so CPU % and network speed look alive.
let ticks = 0;
function fakeProc(): string {
  ticks++;
  const busy = 1000 * ticks + Math.round(Math.random() * 300 + 150 * Math.sin(ticks / 4) + 200);
  const idle = 3000 * ticks;
  const rx = 1.5e6 * ticks + Math.random() * 1e6;
  const tx = 0.3e6 * ticks;
  return [
    `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0`,
    'cpu0 1 0 0 1 0 0 0 0 0 0', 'cpu1 1 0 0 1 0 0 0 0 0 0', 'cpu2 1 0 0 1 0 0 0 0 0 0', 'cpu3 1 0 0 1 0 0 0 0 0 0',
    'MemTotal:        8000000 kB', `MemAvailable:    ${4800000 - Math.round(Math.random() * 200000)} kB`,
    'SwapTotal:       2000000 kB', 'SwapFree:        2000000 kB',
    '0.42 0.38 0.31 1/234 5678',
    'Inter-|   Receive', ' face |bytes',
    `  eth0: ${Math.round(rx)} 0 0 0 0 0 0 0 ${Math.round(tx)} 0 0 0 0 0 0 0`,
    '    lo: 999999 0 0 0 0 0 0 0 999999 0 0 0 0 0 0 0',
  ].join(NL);
}

function fakeJournal(): CockpitProcess {
  let streamCb: ((d: string) => void) | null = null;
  let timer = 0;
  const msgs: [number, string, string][] = [
    [6, 'kino_bot', 'Yangi foydalanuvchi: /start'],
    [6, 'sshd', 'Accepted publickey for home-server'],
    [4, 'fail2ban', "Ban: noma'lum IP, 5 xato urinish"],
    [6, 'watchdog', 'Internet OK (1.1.1.1)'],
    [6, 'docker', 'milano-kafe qayta ishga tushdi'],
    [6, 'apt', '4 ta yangilanish mavjud'],
  ];
  let n = 0;
  const line = () => {
    const [p, id, m] = msgs[n++ % msgs.length];
    return JSON.stringify({ __CURSOR: `c${n}`, __REALTIME_TIMESTAMP: String(Date.now() * 1000), PRIORITY: String(p), SYSLOG_IDENTIFIER: id, MESSAGE: m }) + NL;
  };
  const p = makeProcess(new Promise<string>(() => {}));
  p.stream = (cb) => {
    streamCb = cb;
    setTimeout(() => streamCb?.(Array.from({ length: 6 }, line).join('')), 300);
    timer = window.setInterval(() => streamCb?.(line()), 4000);
    return p;
  };
  p.close = () => window.clearInterval(timer);
  return p;
}

function file<T>(path: string, opts: CockpitFileOptions<T> = {}): CockpitFile<T> {
  const key = `mock-file:${path}`;
  // panel settings persist in localStorage; everything else lives in the fake FS
  const inFs = !path.includes('/.config/mirkomil-panel/');
  const load = (): T | null => {
    const raw = inFs ? fsRead(path) ?? fakeFiles[path] ?? null : localStorage.getItem(key) ?? null;
    if (raw === null) return null;
    if (opts.binary) return new TextEncoder().encode(raw) as unknown as T;
    return opts.syntax ? opts.syntax.parse(raw) : (raw as unknown as T);
  };
  const watchers = new Set<(c: T | null, tag: string) => void>();
  return {
    path,
    read: async () => load(),
    replace: async (content) => {
      const text = content === null ? null : opts.syntax ? opts.syntax.stringify(content) : String(content);
      if (inFs) fsWrite(path, text);
      else if (text === null) localStorage.removeItem(key);
      else localStorage.setItem(key, text);
      const tag = String(Date.now());
      watchers.forEach((w) => w(content, tag));
      return tag;
    },
    watch: (cb) => {
      watchers.add(cb);
      queueMicrotask(() => cb(load(), '1'));
      return { remove: () => watchers.delete(cb) };
    },
    close: () => watchers.clear(),
  };
}

// fsreplace1 upload channel: acknowledges bytes slowly so progress bars move.
function channel(options: Record<string, unknown>): CockpitChannel {
  const handlers: Record<string, ((ev: unknown, msg: never) => void)[]> = {};
  const emit = (ev: string, msg: unknown) => (handlers[ev] ?? []).forEach((h) => h(null, msg as never));
  let size = 0;
  return {
    send: (data) => {
      const n = typeof data === 'string' ? data.length : data.length;
      size += n;
      setTimeout(() => emit('control', { command: 'ack', bytes: n }), 30);
    },
    control: (msg: CockpitChannelControl) => {
      if (msg.command === 'done') {
        setTimeout(() => {
          fsWrite(String(options.path), `uploaded ${size} bytes`);
          emit('close', {});
        }, 200);
      }
    },
    close: (problem) => emit('close', { problem: problem ?? null, message: problem }),
    addEventListener: (ev: string, cb: (ev: unknown, msg: never) => void) => {
      (handlers[ev] ??= []).push(cb);
    },
  } as CockpitChannel;
}

function permission(): CockpitPermission {
  return { allowed: true, addEventListener() {}, removeEventListener() {}, close() {} };
}

// cockpit.location is hash-based in real Cockpit too, so mimic that.
function makeLocation(): CockpitLocation {
  const [rawPath, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const path = rawPath.split('/').filter(Boolean);
  const options = Object.fromEntries(new URLSearchParams(query));
  const go = (p: string | string[], opts?: Record<string, string>) => {
    const q = opts && Object.keys(opts).length ? '?' + new URLSearchParams(opts).toString() : '';
    location.hash = '/' + (Array.isArray(p) ? p.join('/') : p.replace(/^\//, '')) + q;
  };
  return { path, options, href: '/' + path.join('/'), go, replace: go };
}

// Fake Guardian API (same JSON shapes as agent/mirkomil/api.py).
const rulesState = {
  mode: 'dryrun',
  rules: [
    { id: 'restart-failed', title: 'Ishlamay qolgan servisni qayta ishga tushirish', enabled: true, risky: false, cooldown_s: 300, max_attempts: 3, last_action: 0, attempts: 0 },
    { id: 'disk-cleanup', title: 'Diskni tozalash (apt kesh, jurnal, eski Docker obrazlari)', enabled: true, risky: false, cooldown_s: 1800, max_attempts: 3, last_action: 0, attempts: 0 },
    { id: 'tailscale-restart', title: "Tailscale'ni qayta ulash", enabled: true, risky: false, cooldown_s: 600, max_attempts: 3, last_action: 0, attempts: 0 },
    { id: 'network-recover', title: 'Internet uzildi: tarmoqni qayta ishga tushirish', enabled: true, risky: false, cooldown_s: 300, max_attempts: 2, last_action: 0, attempts: 0 },
    { id: 'network-reboot', title: "Internet uzoq vaqt yo'q: serverni qayta yoqish", enabled: false, risky: true, cooldown_s: 21600, max_attempts: 1, last_action: 0, attempts: 0 },
  ],
};

function mockDeploy(ts: number, state: string, step: string) {
  const id = state === 'running' ? '20261126-120000-aaaa' : `2026112${ts % 7}-0${ts % 9}0000-bb${ts % 10}c`;
  return { id, app: 'milano-kafe', by: 'home-server', state, step, started: ts, type: 'django', web: true, port: 8000,
    commit: '3f9c2e1 Menyu sahifasi', image: `mirkomil/app-milano-kafe:${id}`, error: state === 'failed' ? "yangi versiya sog'liq tekshiruvidan o'tmadi" : undefined };
}

function mockApps(now: number) {
  return [
    { name: 'milano-kafe', repo: 'https://github.com/mirkomil/milano-kafe', branch: 'main', type: null, port: 0, mem_mb: 512, cpus: 1,
      created_by: 'home-server', created_at: now - 864000, current: { deploy_id: 'x', container: 'mk-milano-kafe-1', web: true, type: 'django' },
      last_deploy: mockDeploy(now - 30, 'running', 'build'), url: 'http://milano-kafe.mirkomil-host.uz', stats: { cpu: '4.1%', mem: '182MiB / 512MiB', memPerc: '35%' } },
    { name: 'kino-bot', repo: 'https://github.com/mirkomil/kino_bot', branch: 'main', type: 'bot', port: 0, mem_mb: 256, cpus: 0.5,
      created_by: 'home-server', created_at: now - 400000, current: { deploy_id: 'y', container: 'mk-kino-bot-1', web: false, type: 'bot' },
      last_deploy: { ...mockDeploy(now - 172800, 'success', 'switch'), app: 'kino-bot', type: 'bot', commit: 'a1b2c3d /start menyusi' }, url: null, stats: { cpu: '0.8%', mem: '64MiB / 256MiB', memPerc: '25%' } },
    { name: 'landing', repo: 'https://github.com/mirkomil/landing', branch: 'main', type: 'static', port: 0, mem_mb: 128, cpus: 0.25,
      created_by: 'home-server', created_at: now - 90000, current: {}, last_deploy: { ...mockDeploy(now - 5400, 'failed', 'health'), app: 'landing', type: 'static' }, url: null, stats: null },
  ];
}

function http(): ReturnType<Cockpit['http']> {
  const now = () => Math.floor(Date.now() / 1000);
  const series = (span: number, base: number, amp: number) =>
    Array.from({ length: 120 }, (_, i) => [now() - span + (i * span) / 120, +(base + amp * Math.sin(i / 9) + Math.random() * amp * 0.4).toFixed(1)]);
  const routes: Record<string, (p: Record<string, string>) => unknown> = {
    '/v1/me': () => ({ user: 'home-server', role: 'admin', groups: ['sudo'] }),
    '/v1/status': () => ({
      hostname: 'home-server', brand: 'Mirkomil Host', domain: 'mirkomil-host.uz', time: now(), uptime: 1054321, score: 92, status: 'warn', telegram: true, ip: '192.168.1.20', tailscale_ip: '100.101.102.103', os: 'Ubuntu 26.04.1 LTS',
      metrics: { cpu: 23, mem: 39, disk: 41, load1: 0.42, temp: null },
      checks: [
        { id: 'disk', severity: 'ok', title: 'Disk 41% band', detail: '' },
        { id: 'memory', severity: 'ok', title: 'Xotira 39% band', detail: '' },
        { id: 'internet', severity: 'ok', title: 'Internet bor', detail: '' },
        { id: 'dns', severity: 'ok', title: 'DNS ishlayapti', detail: '' },
        { id: 'failed_units', severity: 'ok', title: 'Barcha servislar ishlayapti', detail: '' },
        { id: 'updates', severity: 'warn', title: '4 ta xavfsizlik yangilanishi kutmoqda', detail: "Unattended-upgrades ularni avtomatik o'rnatadi." },
      ],
    }),
    '/v1/history': (p) => {
      const span = { '1h': 3600, '24h': 86400, '7d': 604800 }[p.range as '1h'] ?? 3600;
      return { range: p.range, series: { cpu: series(span, 25, 12), mem: series(span, 40, 4) } };
    },
    '/v1/rules': () => rulesState,
    '/v1/apps': () => ({ domain: 'mirkomil-host.uz', apps: mockApps(now()) }),
    '/v1/databases': () => ({ databases: [
      { name: 'shop-db', kind: 'postgres', image: 'postgres:17.6-alpine', mem_mb: 256, created_by: 'home-server', created_at: now() - 3600, attached: ['milano-kafe'], state: 'running', host: 'mk-db-shop-db', port: 5432 },
      { name: 'cache', kind: 'redis', image: 'redis:7.4.6-alpine', mem_mb: 128, created_by: 'home-server', created_at: now() - 3000, attached: [], state: 'running', host: 'mk-db-cache', port: 6379 },
    ] }),
    '/v1/apps/milano-kafe': () => ({ ...mockApps(now())[0], env: [{ key: 'DATABASE_URL', length: 58 }, { key: 'SECRET_KEY', length: 50 }],
      deploys: [mockDeploy(now() - 30, 'running', 'build'), mockDeploy(now() - 7200, 'success', 'switch'), mockDeploy(now() - 86400, 'failed', 'health')] }),
    '/v1/apps/milano-kafe/deploys/20261126-120000-aaaa': () => ({ status: mockDeploy(now() - 30, 'running', 'build'), next: 1,
      text: '\n==> Kod yuklanmoqda: https://github.com/mirkomil/milano-kafe (main)\ncommit: 3f9c2e1 Menyu sahifasi\n\n==> Loyiha turi aniqlanmoqda\ntur: django\n\n==> Docker obraz yig\'ilmoqda\n#5 [3/6] RUN pip install -r requirements.txt && pip install gunicorn\n#5 12.4 Successfully installed Django-5.1.4 gunicorn-23.0.0 …\n' }),
    '/v1/apps/kino-bot/logs': () => ({ text: '2026-11-26T18:20:01Z INFO Bot ishga tushdi\n2026-11-26T18:21:44Z INFO Yangi foydalanuvchi: /start\n' }),
    '/v1/tunnel': () => ({ configured: true, domain: 'mirkomil-host.uz', panel_host: 'panel.mirkomil-host.uz', team: 'mirkomil.cloudflareaccess.com',
      hosts: ['panel.mirkomil-host.uz', 'milano-kafe.mirkomil-host.uz', 'kino-bot.mirkomil-host.uz', 'mirkomil-host.uz'],
      emails: ['admin@example.com'], root_app: 'milano-kafe', status: 'healthy', connections: 4, service: 'active' }),
    '/v1/apps/milano-kafe/webhook': () => ({ enabled: true, url: 'https://hooks.mirkomil-host.uz/github/milano-kafe', pending: null, deliveries: [
      { ts: now() - 120, event: 'push', result: 'deployed', detail: '3f9c2e1 Menyu sahifasi' },
      { ts: now() - 3600, event: 'push', result: 'ignored', detail: "dev branch — kuzatilmaydi (main)" },
      { ts: now() - 7200, event: 'ping', result: 'ok', detail: 'GitHub ulanishni tekshirdi' },
    ] }),
    '/v1/admins': () => ({ emails: ['mirkomilcoder@gmail.com', 'mirsaid202805@gmail.com'] }),
    '/v1/login': () => ({ configured: true, providers: ['google', 'onetimepin'], sso: true,
      callback: 'https://round-silence-7567.cloudflareaccess.com/cdn-cgi/access/callback' }),
    '/v1/users': () => ({ users: [
      { user: 'home-server', uid: 1000, name: 'Mirkomil', role: 'admin', owner: true, managed: true, locked: false, must_change: false,
        groups: ['adm'], email: null, invited_by: null, invited_at: null, apps: [] },
      { user: 'ali', uid: 1001, name: 'Ali Valiyev', role: 'developer', owner: false, managed: true, locked: false, must_change: true,
        groups: [], email: 'ali@example.com', invited_by: 'home-server', invited_at: now() - 3600, apps: ['milano-kafe'] },
      { user: 'zara', uid: 1002, name: 'Zarina', role: 'viewer', owner: false, managed: true, locked: true, must_change: false,
        groups: ['systemd-journal'], email: null, invited_by: 'home-server', invited_at: now() - 86400 * 3, apps: [] },
    ] }),
    '/v1/users/groups': () => ({ groups: [
      { name: 'adm', about: "tizim loglarini o'qish (/var/log)" },
      { name: 'systemd-journal', about: "jurnalni (journalctl) to'liq o'qish" },
      { name: 'www-data', about: 'veb-server fayllari bilan ishlash' },
    ] }),
    '/v1/identity': () => ({ brand: 'Mirkomil Host', domain: 'mirkomil-host.uz' }),
    '/v1/events': () => ({
      events: [
        { id: 4, ts: now() - 600, kind: 'problem', severity: 'warn', title: '4 ta xavfsizlik yangilanishi kutmoqda', detail: '', actor: 'guardian' },
        { id: 3, ts: now() - 7200, kind: 'recovered', severity: 'ok', title: 'Tuzaldi: Internet bor', detail: '', actor: 'guardian' },
        { id: 2, ts: now() - 7500, kind: 'problem', severity: 'crit', title: "Internet yo'q", detail: '1.1.1.1, 8.8.8.8 va 9.9.9.9 ga ulanib bo‘lmadi.', actor: 'guardian' },
        { id: 1, ts: now() - 86400, kind: 'info', severity: 'info', title: 'Guardian ishga tushdi', detail: '', actor: 'guardian' },
      ],
    }),
  };
  return {
    get: async (path, params) => {
      const r = routes[path];
      if (!r) throw { status: 404, reason: 'Not Found', message: 'not found' };
      return JSON.stringify(r(params ?? {}));
    },
    post: async (path, body) => {
      const b = JSON.parse(String(body ?? '{}')) as { mode?: string; rule?: string; enabled?: boolean; user?: string; role?: string };
      if (path.endsWith('/webhook/reveal')) return JSON.stringify({ secret: '9f2c4e7a1b3d5f6e8a0c2e4b6d8f0a1c3e5b7d9f1a2c4e6b' });
      if (path.endsWith('/env/reveal')) {
        return JSON.stringify({ env: [{ key: 'DATABASE_URL', value: 'postgresql://app:Xk29fLq7@mk-db-shop-db:5432/shop' },
          { key: 'SECRET_KEY', value: 'django-insecure-9f8a7s6d5f4g3h2j1k' }, { key: 'DEBUG', value: 'False' }] });
      }
      if (path.endsWith('/env')) return JSON.stringify({ env: [] });
      if (path === '/v1/users' || path.endsWith('/password')) {
        return JSON.stringify({ user: b.user ?? path.split('/')[3], role: b.role ?? 'developer', password: 'k7mp-x3qa-9fhz-w2nd',
          panel_url: 'https://panel.mirkomil-host.uz', email: 'ali@example.com', access: 'ok' });
      }
      if (b.mode) rulesState.mode = b.mode;
      if (b.rule) rulesState.rules = rulesState.rules.map((r) => (r.id === b.rule ? { ...r, enabled: !!b.enabled } : r));
      return JSON.stringify(rulesState);
    },
    close: () => {},
  };
}

// Fake cockpit.Superuser: asks for a password once, accepts anything non-empty.
function dbus(): ReturnType<Cockpit['dbus']> {
  const listeners = new Set<(...a: never[]) => void>();
  let pending: ((v: unknown[]) => void) | null = null;
  const proxy = {
    valid: true,
    Bridges: ['sudo'],
    wait: async () => {},
    call: async (method: string, args: unknown[]) => {
      if (method === 'Start') {
        setTimeout(() => listeners.forEach((l) => (l as unknown as (...x: unknown[]) => void)({}, '', '[sudo] password for home-server: ', '', false, '')), 200);
        return new Promise<unknown[]>((res) => (pending = res));
      }
      if (method === 'Answer' && pending) {
        const ok = String(args[0]).length > 0;
        setTimeout(() => { if (ok) { pending?.([]); pending = null; } }, 400);
      }
      return [];
    },
    addEventListener: (_ev: string, cb: (...a: never[]) => void) => listeners.add(cb),
    removeEventListener: (_ev: string, cb: (...a: never[]) => void) => listeners.delete(cb),
  };
  return { proxy: () => proxy, close: () => {} };
}

export function createMockCockpit(): Cockpit {
  const user = { id: 1000, name: 'home-server', full_name: 'Mirkomil', home: '/home/home-server' };
  return {
    __mock: true,
    init: async () => {},
    info: {
      user,
      os_release: { NAME: 'Ubuntu', VERSION: '26.04.1 LTS (Mock)', VERSION_ID: '26.04', PRETTY_NAME: 'Ubuntu 26.04.1 LTS' },
      ws: { version: 'mock' },
    },
    user: async () => user,
    spawn,
    http,
    dbus,
    file,
    channel,
    permission,
    get location() {
      return makeLocation();
    },
    jump: (p) => console.info('[mock] cockpit.jump', p),
    logout: () => console.info('[mock] logout'),
    hidden: false,
    addEventListener: (ev, cb) => {
      if (ev === 'locationchanged') window.addEventListener('hashchange', cb);
    },
    removeEventListener: (ev, cb) => {
      if (ev === 'locationchanged') window.removeEventListener('hashchange', cb);
    },
  };
}
