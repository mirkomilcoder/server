import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { apps, type DeployStatus } from '@/api/guardian';
import { useT, type TranslationKey } from '@/i18n';

/*
 * Live deploy progress: 7 steps + the streamed log (read incrementally with
 * an offset, so a long build log is never re-downloaded).
 */

const STEPS = ['clone', 'detect', 'build', 'proxy', 'start', 'health', 'switch'] as const;

export function DeployLog({ app, id, onDone }: { app: string; id: string; onDone?: (s: DeployStatus) => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [text, setText] = useState('');
  const box = useRef<HTMLPreElement>(null);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    let offset = 0;
    let timer = 0;
    done.current = false;
    setText('');
    const tick = async () => {
      try {
        const r = await apps.deployLog(app, id, offset);
        if (!alive) return;
        offset = r.next;
        if (r.text) setText((x) => (x + r.text).slice(-400_000));
        setStatus(r.status);
        if (r.status.state !== 'running') {
          if (!done.current) {
            done.current = true;
            onDone?.(r.status);
          }
          return;
        }
      } catch {
        /* transient: try again */
      }
      if (alive) timer = window.setTimeout(tick, 1500);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, id]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);

  const rollbackRun = status?.step === 'rollback';
  const steps = rollbackRun ? STEPS.filter((s) => !['clone', 'detect', 'build'].includes(s)) : STEPS;
  const cur = status ? steps.indexOf(status.step as (typeof STEPS)[number]) : -1;

  return (
    <div className="deploy-log">
      <ol className="steps">
        {steps.map((s, i) => {
          const failed = status?.state === 'failed' && i === cur;
          const ok = status?.state === 'success' || i < cur;
          const active = status?.state === 'running' && i === cur;
          return (
            <li key={s} className={`step${ok ? ' step--ok' : ''}${active ? ' step--active' : ''}${failed ? ' step--failed' : ''}`}>
              <span className="step__dot">
                {failed ? <X size={13} /> : ok ? <Check size={13} /> : active ? <Loader2 size={13} className="spin" /> : i + 1}
              </span>
              <span className="step__label">{t(`app.step.${s}` as TranslationKey)}</span>
            </li>
          );
        })}
      </ol>
      {status?.state === 'failed' && status.error && <div className="notice notice--danger">{status.error}</div>}
      <pre className="console console--tall" ref={box}>{text || '…'}</pre>
    </div>
  );
}
