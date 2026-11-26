import { motion } from 'framer-motion';
import { useT } from '@/i18n';
import { useSettings } from '@/state/settings';
import { useMotion } from '@/theme/motion';
import { MODES } from '@/modes';

/* Segmented control: Oddiy | Kengaytirilgan | Ixcham. */
export function ModeSwitch({ large = false }: { large?: boolean }) {
  const { t } = useT();
  const { settings, update } = useSettings();
  const m = useMotion();

  return (
    <div className={`segmented${large ? ' segmented--lg' : ''}`} role="radiogroup" aria-label={t('settings.mode')}>
      {MODES.map((mode) => {
        const active = settings.mode === mode.id;
        return (
          <button
            key={mode.id}
            role="radio"
            aria-checked={active}
            className={`segmented__btn${active ? ' segmented__btn--active' : ''}`}
            onClick={() => update({ mode: mode.id })}
          >
            {active && <motion.span layoutId="mode-pill" className="segmented__pill" transition={m.spring} />}
            <span>{t(mode.label)}</span>
          </button>
        );
      })}
    </div>
  );
}
