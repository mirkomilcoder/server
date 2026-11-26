import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/theme/motion';

/*
 * Tiny SVG sparkline (no chart library needed). Optional soft area fill.
 * It "draws in" on first render by revealing it through a growing clip rect
 * (works with non-scaling strokes, unlike the pathLength dash trick).
 */
export function Sparkline({ data, color, max, height = 34, area = false }: { data: number[]; color: string; max?: number; height?: number; area?: boolean }) {
  const m = useMotion();
  // useId() returns ':r1:' — colons break url(#…) references in SVG
  const id = useId().replace(/:/g, '');
  const w = 200;
  const line = useMemo(() => {
    if (data.length < 2) return '';
    const top = max ?? Math.max(...data, 1e-6);
    const step = w / (data.length - 1);
    return data
      .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 3 - (Math.min(v, top) / top) * (height - 8)).toFixed(1)}`)
      .join(' ');
  }, [data, max, height]);

  if (!line) return <div className="kpi__viz" style={{ height }} />;
  return (
    <svg className="kpi__viz" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden>
      <defs>
        <clipPath id={`${id}-clip`}>
          <motion.rect x="0" y="0" height={height} initial={{ width: m.off ? w : 0 }} animate={{ width: w }} transition={{ duration: m.dur(1.1), ease: [0.2, 0.8, 0.2, 1] }} />
        </clipPath>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: color, stopOpacity: 0.32 }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        {area && <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id}-fill)`} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}
