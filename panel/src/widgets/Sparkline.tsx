import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/theme/motion';

/*
 * Tiny SVG sparkline (no chart library needed for 34px-tall lines).
 * It "draws in" on first render by revealing it through a growing clip rect
 * (works with non-scaling strokes, unlike the pathLength dash trick).
 */
export function Sparkline({ data, color, max, height = 34 }: { data: number[]; color: string; max?: number; height?: number }) {
  const m = useMotion();
  const clip = useId();
  const w = 200;
  const d = useMemo(() => {
    if (data.length < 2) return '';
    const top = max ?? Math.max(...data, 1);
    const step = w / (data.length - 1);
    return data
      .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 3 - (Math.min(v, top) / top) * (height - 6)).toFixed(1)}`)
      .join(' ');
  }, [data, max, height]);

  if (!d) return <div className="kpi__viz" />;
  return (
    <svg className="kpi__viz" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <motion.rect x="0" y="0" height={height} initial={{ width: m.off ? w : 0 }} animate={{ width: w }} transition={{ duration: m.dur(1.1), ease: [0.2, 0.8, 0.2, 1] }} />
        </clipPath>
      </defs>
      <path
        d={d}
        clipPath={`url(#${clip})`}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
