import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Power, RotateCcw } from 'lucide-react';
import { useAction } from '@/hooks/useAction';
import { useT } from '@/i18n';
import { useSystem } from '@/state/system';
import { useMotion } from '@/theme/motion';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { PageProps } from './registry';

/*
 * Reboot / shutdown. Two locks: type the hostname, then a 5-second
 * countdown that can still be cancelled. The action itself is privileged
 * and written to the activity log by run.ts.
 */

type Kind = 'reboot' | 'shutdown';
const COUNTDOWN = 5;

export default function PowerPage(_props: PageProps) {
  const { t } = useT();
  const sys = useSystem();
  const m = useMotion();
  const { run, isAdmin } = useAction();
  const [confirm, setConfirm] = useState<Kind | null>(null);
  const [counting, setCounting] = useState<{ kind: Kind; left: number } | null>(null);
  const [sent, setSent] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);

  const start = (kind: Kind) => {
    setConfirm(null);
    setCounting({ kind, left: COUNTDOWN });
    timer.current = window.setInterval(() => {
      setCounting((c) => {
        if (!c) return c;
        if (c.left <= 1) {
          window.clearInterval(timer.current);
          void run(c.kind === 'reboot' ? 'power.reboot' : 'power.poweroff', {}).then((out) => out !== null && setSent(true));
          return null;
        }
        return { ...c, left: c.left - 1 };
      });
    }, 1000);
  };

  const cancel = () => {
    window.clearInterval(timer.current);
    setCounting(null);
  };

  const cards: { kind: Kind; icon: typeof Power; title: string; body: string; tone: 'warning' | 'danger' }[] = [
    { kind: 'reboot', icon: RotateCcw, title: t('power.reboot'), body: t('power.reboot.body'), tone: 'warning' },
    { kind: 'shutdown', icon: Power, title: t('power.shutdown'), body: t('power.shutdown.body'), tone: 'danger' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('power.title')}</h1>
          <p className="muted">{t('power.intro')}</p>
        </div>
      </div>

      {sent && <div className="notice notice--info" role="status">{t('power.sent')}</div>}

      <motion.div className="power-grid" variants={m.stagger} initial="hidden" animate="show">
        {cards.map((c) => (
          <motion.section key={c.kind} className={`power-card power-card--${c.tone}`} variants={m.item}>
            <span className={`power-card__icon tint--${c.tone}`}><c.icon size={30} strokeWidth={1.8} /></span>
            <h2>{c.title}</h2>
            <p>{c.body}</p>
            {counting?.kind === c.kind ? (
              <div className="power-card__count">
                <span className="power-card__secs" aria-live="assertive">{t('power.countdown', { s: counting.left })}</span>
                <button className="btn" onClick={cancel}>{t('common.cancel')}</button>
              </div>
            ) : (
              <button className={`btn btn--${c.tone} btn--block`} disabled={!!counting || sent}
                onClick={() => (isAdmin ? setConfirm(c.kind) : run(c.kind === 'reboot' ? 'power.reboot' : 'power.poweroff', {}))}>
                <c.icon size={17} /> {c.title}
                <span className="badge badge--warning">{t('admin.badge')}</span>
              </button>
            )}
          </motion.section>
        ))}
      </motion.div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm === 'shutdown' ? t('power.shutdown') : t('power.reboot')}
        body={confirm === 'shutdown' ? t('power.shutdown.body') : t('power.reboot.body')}
        confirmLabel={confirm === 'shutdown' ? t('power.shutdown') : t('power.reboot')}
        tone={confirm === 'shutdown' ? 'danger' : 'warning'}
        expected={sys.hostname}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && start(confirm)}
      />
    </>
  );
}
