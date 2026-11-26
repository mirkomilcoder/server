import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { guardian, type RulesState } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT } from '@/i18n';
import { useToast } from '@/state/toasts';
import { Card } from './Card';
import { RowsSkeleton } from './Skeletons';

/*
 * Self-healing controls: global mode (dry run / automatic) and per-rule
 * switches. Guardian enforces "admin only" on the server; the UI just
 * disables the controls for other roles.
 */
export function HealingCard({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useT();
  const toast = useToast();
  const polled = usePoll(guardian.rules, 15000);
  const [local, setLocal] = useState<RulesState | null>(null);
  const [busy, setBusy] = useState(false);
  const state = local ?? polled.data;

  const apply = async (fn: () => Promise<RulesState>) => {
    setBusy(true);
    try {
      setLocal(await fn());
    } catch (e) {
      toast({ kind: 'error', title: t('settings.saveFailed'), details: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const modeSwitch = state && (
    <div className="segmented" role="radiogroup" aria-label={t('guardian.heal')}>
      {(['dryrun', 'auto'] as const).map((mode) => (
        <button
          key={mode}
          role="radio"
          aria-checked={state.mode === mode}
          disabled={!isAdmin || busy}
          title={isAdmin ? undefined : t('guardian.adminOnly')}
          className={`segmented__btn${state.mode === mode ? ' segmented__btn--active' : ''}`}
          onClick={() => state.mode !== mode && apply(() => guardian.setMode(mode))}
        >
          {state.mode === mode && <span className="segmented__pill" />}
          <span>{t(mode === 'auto' ? 'guardian.mode.auto' : 'guardian.mode.dryrun')}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Card title={<><Wrench size={18} style={{ verticalAlign: -3, marginRight: 8 }} />{t('guardian.heal')}</>} tools={modeSwitch}>
      {!state ? (
        <RowsSkeleton rows={4} h={44} />
      ) : (
        <>
          <p className="card__meta" style={{ marginBottom: 12, fontSize: 13 }}>
            {t(state.mode === 'auto' ? 'guardian.mode.auto.help' : 'guardian.mode.dryrun.help')}
          </p>
          {state.rules.map((r) => (
            <div className="list-line" key={r.id}>
              <span>
                <span style={{ fontWeight: 500 }}>{r.title}</span>
                {r.risky && <span className="pill pill--warning" style={{ marginLeft: 8 }}>{t('guardian.risky')}</span>}
                <span className="row__meta" style={{ display: 'block' }}>
                  {t('guardian.cooldown', { m: Math.round(r.cooldown_s / 60), n: r.max_attempts })}
                </span>
              </span>
              <label className="switch" title={isAdmin ? undefined : t('guardian.adminOnly')}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={r.enabled}
                  disabled={!isAdmin || busy}
                  onChange={(e) => apply(() => guardian.setRule(r.id, e.target.checked))}
                  aria-label={r.title}
                />
                <span className="switch__track" aria-hidden />
              </label>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
