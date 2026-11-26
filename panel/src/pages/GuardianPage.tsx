import { AlertTriangle, CheckCircle2, Info, RotateCcw, Send, ShieldAlert, XCircle } from 'lucide-react';
import { guardian, GuardianUnavailable, type GuardianEvent, type Severity } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT, type TranslationKey } from '@/i18n';
import { useSettings } from '@/state/settings';
import { Card, MotionGrid } from '@/widgets/Card';
import { ScoreRing } from '@/widgets/ScoreRing';
import { RowsSkeleton } from '@/widgets/Skeletons';
import { HealingCard } from '@/widgets/HealingCard';
import type { PageProps } from './registry';

/* Nazorat: Guardian health score, live checks and the problem/recovery timeline. */

const SEV_ICON = { ok: CheckCircle2, info: Info, warn: AlertTriangle, crit: XCircle };
const SEV_TINT: Record<Severity, string> = { ok: 'success', info: 'info', warn: 'warning', crit: 'danger' };
const KIND_ICON = { problem: ShieldAlert, recovered: CheckCircle2, action: RotateCcw, info: Info };

function scoreColor(score: number) {
  return score >= 85 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';
}
const statusColor = (s: Severity) => (s === 'crit' ? 'var(--danger-text)' : s === 'warn' ? 'var(--warning-text)' : 'var(--success-text)');

function EventRow({ e, fmt }: { e: GuardianEvent; fmt: Intl.DateTimeFormat }) {
  const Icon = KIND_ICON[e.kind] ?? Info;
  return (
    <div className="row">
      <span className={`tile__icon tint--${SEV_TINT[e.severity]}`} style={{ width: 36, height: 36, borderRadius: 10, marginBottom: 0 }}>
        <Icon size={18} aria-hidden />
      </span>
      <div className="row__main">
        <div style={{ fontWeight: 600 }}>{e.title}</div>
        {e.detail && <div className="row__meta">{e.detail}</div>}
      </div>
      <time className="row__meta mono" dateTime={new Date(e.ts * 1000).toISOString()}>
        {fmt.format(new Date(e.ts * 1000))}
      </time>
    </div>
  );
}

export default function GuardianPage(_props: PageProps) {
  const { t, locale } = useT();
  const { settings } = useSettings();
  const status = usePoll(guardian.status, Math.max(settings.refreshMs, 5000));
  const events = usePoll(() => guardian.events(50), 15000);
  const me = usePoll(guardian.me, 60000);
  const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  if (status.error instanceof GuardianUnavailable) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty__icon tint--warning"><ShieldAlert size={28} /></div>
          <h2>{t('guardian.unavailable')}</h2>
          <p className="mono">{t('guardian.unavailable.hint')}</p>
        </div>
      </div>
    );
  }

  const s = status.data;
  return (
    <>
      <div className="page-head">
        <h1>{t('guardian.title')}</h1>
        {s && (
          <span className={`pill ${s.telegram ? 'pill--success' : 'pill--muted'}`}>
            <Send size={13} aria-hidden /> {t(s.telegram ? 'guardian.telegram.on' : 'guardian.telegram.off')}
          </span>
        )}
      </div>
      <MotionGrid className="grid grid--main">
        <Card title={t('guardian.checks')}>
          {!s ? (
            <RowsSkeleton rows={6} h={44} />
          ) : (
            s.checks.map((c) => {
              const Icon = SEV_ICON[c.severity];
              return (
                <div className="list-line" key={c.id}>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                    <Icon size={18} style={{ color: `var(--${SEV_TINT[c.severity]})`, flex: 'none', marginTop: 2 }} aria-hidden />
                    <span>
                      <span style={{ fontWeight: 500 }}>{c.title}</span>
                      {c.detail && <span className="row__meta" style={{ display: 'block' }}>{c.detail}</span>}
                    </span>
                  </span>
                  <span className={`pill pill--${SEV_TINT[c.severity]}`}>{t(`sev.${c.severity}` as TranslationKey)}</span>
                </div>
              );
            })
          )}
        </Card>
        <Card title={t('guardian.score')}>
          <div className="score" style={{ marginTop: 8 }}>
            <ScoreRing score={s?.score ?? null} color={s ? scoreColor(s.score) : undefined} />
            <div>
              <div className="score__title" style={{ color: s ? statusColor(s.status) : undefined }}>
                {s ? t(`guardian.status.${s.status === 'info' ? 'ok' : s.status}` as TranslationKey) : '…'}
              </div>
              <div className="card__meta">{s?.hostname}</div>
            </div>
          </div>
        </Card>
      </MotionGrid>
      <MotionGrid className="grid">
        <HealingCard isAdmin={me.data?.role === 'admin'} />
        <Card title={t('guardian.timeline')}>
          {!events.data ? (
            <RowsSkeleton rows={4} />
          ) : events.data.events.length === 0 ? (
            <p className="muted">{t('guardian.noEvents')}</p>
          ) : (
            events.data.events.map((e) => <EventRow key={e.id} e={e} fmt={fmt} />)
          )}
        </Card>
      </MotionGrid>
    </>
  );
}
