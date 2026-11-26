import { motion } from 'framer-motion';
import { useMotion } from '@/theme/motion';

/* Circular 0–100 score (security). */
export function ScoreRing({ score, color = 'var(--success)' }: { score: number | null; color?: string }) {
  const m = useMotion();
  const r = 27;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;

  return (
    <div className="score__ring">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-raised)" strokeWidth="6" />
        <motion.circle
          cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: m.dur(1), ease: [0.2, 0.8, 0.2, 1] }}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <div className="score__num">{score ?? '–'}</div>
    </div>
  );
}
