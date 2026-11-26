import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUpgradable } from './pages/UpdatesPage';
import { parseFail2ban, parseSshd, parseUfw, securityScore } from './pages/SecurityPage';
import { parseProc } from './api/metrics';
import { parseJournalLine } from './api/journal';

/* Fixtures in __fixtures__ are real outputs captured from the Ubuntu 26.04 VM. */
const fx = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('apt list --upgradable', () => {
  it('parses packages and flags security updates', () => {
    const out = [
      'Listing...',
      'openssl/resolute-updates,resolute-security 3.5.2-1ubuntu1.1 amd64 [upgradable from: 3.5.2-1ubuntu1]',
      'curl/resolute-updates 8.14.1-2ubuntu1.2 amd64 [upgradable from: 8.14.1-2ubuntu1.1]',
    ].join('\n');
    const pkgs = parseUpgradable(out);
    expect(pkgs).toHaveLength(2);
    expect(pkgs[0]).toEqual({ name: 'openssl', from: '3.5.2-1ubuntu1', to: '3.5.2-1ubuntu1.1', security: true });
    expect(pkgs[1].security).toBe(false);
  });
  it('handles the real "nothing to upgrade" output', () => {
    expect(parseUpgradable(fx('apt.txt'))).toEqual([]);
  });
});

describe('security parsers (real VM output)', () => {
  it('ufw: active with SSH, Tailscale and LAN rules', () => {
    const u = parseUfw(fx('ufw.txt'));
    expect(u.active).toBe(true);
    expect(u.rules.some((r) => r.startsWith('22/tcp') && r.includes('LIMIT'))).toBe(true);
    expect(u.rules.some((r) => r.includes('9090'))).toBe(true);
  });
  it('fail2ban: empty ban list parses to zero', () => {
    expect(parseFail2ban(fx('fail2ban.txt'))).toEqual({ banned: [], total: 0 });
  });
  it('fail2ban: lists banned IPs', () => {
    const f = parseFail2ban('   |- Total banned:\t7\n   `- Banned IP list:\t203.0.113.5 198.51.100.9');
    expect(f).toEqual({ banned: ['203.0.113.5', '198.51.100.9'], total: 7 });
  });
  it('sshd -T: hardened config is detected', () => {
    expect(parseSshd(fx('sshd.txt'))).toEqual({ password: false, root: false });
  });
  it('score: hardened server with no pending updates scores 100', () => {
    const s = securityScore({ ufw: parseUfw(fx('ufw.txt')), f2b: parseFail2ban(fx('fail2ban.txt')), ssh: parseSshd(fx('sshd.txt')), securityUpdates: 0 });
    expect(s).toEqual({ score: 100, recs: [] });
  });
  it('score: problems lower the score and produce recommendations', () => {
    const s = securityScore({ ufw: { active: false, rules: [] }, f2b: null, ssh: { password: true, root: true }, securityUpdates: 3 });
    expect(s.score).toBeLessThan(30);
    expect(s.recs).toEqual(['sec.rec.ufw', 'sec.rec.f2b', 'sec.rec.password', 'sec.rec.root', 'sec.rec.updates']);
  });
});

describe('/proc parsing (real VM output)', () => {
  it('does not mistake meminfo lines for network interfaces (NaN regression)', () => {
    const p = parseProc(fx('proc.txt'));
    expect(Number.isFinite(p.counters.rx)).toBe(true);
    expect(Number.isFinite(p.counters.tx)).toBe(true);
    expect(p.counters.rx).toBeGreaterThan(0);
    expect(p.mem.total).toBeGreaterThan(1e9);
    expect(p.cores).toBe(2);
  });
});

describe('journal JSON', () => {
  it('maps priority and decodes byte-array messages', () => {
    const e = parseJournalLine(JSON.stringify({ __CURSOR: 'c1', __REALTIME_TIMESTAMP: '1700000000000000', PRIORITY: '4', SYSLOG_IDENTIFIER: 'sshd', MESSAGE: [104, 105] }));
    expect(e).toMatchObject({ id: 'c1', level: 'warn', source: 'sshd', message: 'hi' });
  });
  it('ignores garbage lines', () => {
    expect(parseJournalLine('not json')).toBeNull();
  });
});
