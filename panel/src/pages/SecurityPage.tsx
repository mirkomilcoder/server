import { useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Lightbulb, ShieldAlert, ShieldCheck, Unlock, XCircle } from 'lucide-react';
import { runAction } from '@/api/run';
import { usePoll } from '@/hooks/usePoll';
import { useAction } from '@/hooks/useAction';
import { useT, type TranslationKey } from '@/i18n';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, MotionGrid } from '@/widgets/Card';
import { ScoreRing } from '@/widgets/ScoreRing';
import { RowsSkeleton } from '@/widgets/Skeletons';
import { parseUpgradable } from './UpdatesPage';
import type { PageProps } from './registry';

/*
 * Security overview → score 0–100 with concrete recommendations.
 * Firewall, fail2ban and sshd settings are root-only, so they are read only
 * when administrative access is on (otherwise a clear hint is shown).
 */

export interface SecFacts {
  ufw: { active: boolean; rules: string[] } | null;
  f2b: { banned: string[]; total: number } | null;
  ssh: { password: boolean; root: boolean } | null;
  securityUpdates: number | null;
}

export function parseUfw(out: string) {
  const active = /^Status:\s+active/m.test(out);
  const rules = out.split('\n').filter((l) => /\b(ALLOW|LIMIT|DENY|REJECT)\b/.test(l)).map((l) => l.replace(/\s{2,}/g, '  ').trim());
  return { active, rules };
}

export function parseFail2ban(out: string) {
  const list = /Banned IP list:\s*(.*)$/m.exec(out)?.[1]?.trim() ?? '';
  const total = Number(/Total banned:\s*(\d+)/.exec(out)?.[1] ?? 0);
  return { banned: list ? list.split(/\s+/) : [], total };
}

export function parseSshd(out: string) {
  const val = (k: string) => new RegExp(`^${k}\\s+(\\S+)`, 'mi').exec(out)?.[1]?.toLowerCase();
  return { password: val('passwordauthentication') === 'yes', root: !['no', 'prohibit-password', 'without-password'].includes(val('permitrootlogin') ?? 'no') };
}

/** 100 minus weighted findings; unknown facts don't count against the score. */
export function securityScore(f: SecFacts) {
  const recs: TranslationKey[] = [];
  let score = 100;
  if (f.ufw && !f.ufw.active) { score -= 35; recs.push('sec.rec.ufw'); }
  if (f.f2b === null && f.ufw) { score -= 10; recs.push('sec.rec.f2b'); }
  if (f.ssh?.password) { score -= 20; recs.push('sec.rec.password'); }
  if (f.ssh?.root) { score -= 15; recs.push('sec.rec.root'); }
  if (f.securityUpdates) { score -= Math.min(20, 5 + f.securityUpdates * 2); recs.push('sec.rec.updates'); }
  return { score: Math.max(0, score), recs };
}

async function readRoot<T>(id: 'security.ufw' | 'security.fail2ban' | 'security.sshd', parse: (s: string) => T): Promise<T | null> {
  try {
    return parse(await runAction(id, {}));
  } catch {
    return null;
  }
}

export default function SecurityPage({ go }: PageProps) {
  const { t } = useT();
  const { run, isAdmin, busy } = useAction();
  const [unban, setUnban] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const facts = usePoll(async (): Promise<SecFacts> => {
    const updates = await runAction('updates.list', {}).then(parseUpgradable).catch(() => null);
    const securityUpdates = updates ? updates.filter((u) => u.security).length : null;
    if (!isAdmin) return { ufw: null, f2b: null, ssh: null, securityUpdates };
    const [ufw, f2b, ssh] = await Promise.all([
      readRoot('security.ufw', parseUfw),
      readRoot('security.fail2ban', parseFail2ban),
      readRoot('security.sshd', parseSshd),
    ]);
    return { ufw, f2b, ssh, securityUpdates };
  }, 30_000, [isAdmin, tick]);

  const f = facts.data;
  const { score, recs } = useMemo(() => (f ? securityScore(f) : { score: 0, recs: [] }), [f]);
  const tone = score >= 85 ? 'success' : score >= 60 ? 'warning' : 'danger';

  const Line = ({ ok, label, value }: { ok: boolean | null; label: string; value: string }) => (
    <div className="list-line">
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {ok === null ? <ShieldAlert size={18} className="subtle" /> : ok ? <CheckCircle2 size={18} style={{ color: 'var(--success)' }} /> : <XCircle size={18} style={{ color: 'var(--danger)' }} />}
        {label}
      </span>
      <span className={ok === false ? 'c-danger' : 'muted'}>{value}</span>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h1>{t('sec.title')}</h1>
      </div>
      {!isAdmin && (
        <div className="notice notice--warning" role="status">
          <KeyRound size={18} /> <span>{t('sec.needAdmin')}</span>
        </div>
      )}

      <MotionGrid className="grid grid--chart">
        <Card title={t('sec.score')}>
          {!f ? <RowsSkeleton rows={3} /> : (
            <>
              <div className="score">
                <ScoreRing score={isAdmin ? score : null} color={`var(--${tone})`} />
                <div>
                  <div className="score__title" style={{ color: `var(--${tone}-text)` }}>
                    {isAdmin ? t(tone === 'success' ? 'sec.good' : tone === 'warning' ? 'sec.fair' : 'sec.poor') : '—'}
                  </div>
                </div>
              </div>
              <Line ok={f.ufw ? f.ufw.active : null} label={t('sec.firewall')} value={f.ufw ? t(f.ufw.active ? 'sec.firewall.on' : 'sec.firewall.off') : '—'} />
              <Line ok={f.f2b ? true : f.ufw ? false : null} label={t('sec.fail2ban')} value={f.f2b ? t('sec.banned', { n: f.f2b.banned.length, t: f.f2b.total }) : '—'} />
              <Line ok={f.ssh ? !f.ssh.password : null} label={t('sec.ssh.password')} value={f.ssh ? t(f.ssh.password ? 'sec.on' : 'sec.off') : '—'} />
              <Line ok={f.ssh ? !f.ssh.root : null} label={t('sec.ssh.root')} value={f.ssh ? t(f.ssh.root ? 'sec.on' : 'sec.off') : '—'} />
              <Line ok={f.securityUpdates === null ? null : f.securityUpdates === 0} label={t('sec.updates')}
                value={f.securityUpdates === null ? '—' : f.securityUpdates ? t('sec.updates.some', { n: f.securityUpdates }) : t('sec.updates.none')} />
            </>
          )}
        </Card>
        <Card title={<><span className="title-icon tint--warning"><Lightbulb size={17} /></span>{t('sec.recs')}</>}>
          {!f || !isAdmin ? <RowsSkeleton rows={3} h={28} /> : recs.length === 0 ? (
            <div className="alert-row"><span className="alert-row__icon tint--success"><ShieldCheck size={18} /></span><div className="alert-row__title">{t('sec.rec.none')}</div></div>
          ) : recs.map((r) => (
            <div className="alert-row" key={r}>
              <span className="alert-row__icon tint--warning"><ShieldAlert size={18} /></span>
              <div className="alert-row__title">{t(r)}</div>
              {r === 'sec.rec.updates' && <button className="btn btn--sm" onClick={() => go('updates')}>{t('updates.title')}</button>}
            </div>
          ))}
        </Card>
      </MotionGrid>

      {f?.ufw && (
        <MotionGrid className="grid grid--bottom">
          <Card title={t('sec.rules')}>
            {f.ufw.rules.length === 0 ? <p className="muted">—</p> : f.ufw.rules.map((r) => <div className="list-line mono" key={r}>{r}</div>)}
          </Card>
          <Card title={t('sec.fail2ban')}>
            {!f.f2b || f.f2b.banned.length === 0 ? <p className="muted">{f.f2b ? t('sec.banned', { n: 0, t: f.f2b.total }) : '—'}</p> : f.f2b.banned.map((ip) => (
              <div className="list-line" key={ip}>
                <span className="mono">{ip}</span>
                <button className="btn btn--sm" disabled={!!busy} onClick={() => setUnban(ip)}><Unlock size={14} /> {t('sec.unban')}</button>
              </div>
            ))}
          </Card>
        </MotionGrid>
      )}

      <ConfirmDialog
        open={!!unban}
        title={t('sec.unban')}
        body={unban ? t('sec.unban.confirm', { ip: unban }) : ''}
        confirmLabel={t('sec.unban')}
        tone="warning"
        onClose={() => setUnban(null)}
        onConfirm={async () => {
          if (unban && (await run('security.unban', { ip: unban }, { success: t('svc.done', { unit: unban }) })) !== null) setTick((x) => x + 1);
          setUnban(null);
        }}
      />
    </>
  );
}
