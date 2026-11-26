import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useT } from '@/i18n';
import { useMetrics, type Point } from '@/state/metrics';
import { useMotion } from '@/theme/motion';
import { guardian, type Range } from '@/api/guardian';
import { Card } from './Card';
import { Skel } from './Skeletons';

/*
 * CPU (accent, filled) + RAM (violet), as plain SVG.
 *  - 1 soat: live samples kept in the browser (works without the agent)
 *  - 24 soat / 7 kun: history stored by the Guardian agent (SQLite)
 */

const W = 800;
const H = 220;
const PAD_B = 22;
const SPAN: Record<Range, number> = { '1h': 3600_000, '24h': 86400_000, '7d': 7 * 86400_000 };

function pathFor(points: Point[], key: 'cpu' | 'ram', t0: number, span: number) {
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / span) * W).toFixed(1)},${(H - PAD_B - (p[key] / 100) * (H - PAD_B - 8)).toFixed(1)}`)
    .join(' ');
}

/** Guardian series {cpu:[[ts,v]], mem:[[ts,v]]} → Point[] */
function toPoints(series: Record<string, [number, number][]>): Point[] {
  const mem = new Map((series.mem ?? []).map(([ts, v]) => [ts, v]));
  return (series.cpu ?? []).map(([ts, v]) => ({ t: ts * 1000, cpu: v, ram: mem.get(ts) ?? 0, net: 0 }));
}

export function ResourceChart({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useT();
  const { history } = useMetrics();
  const m = useMotion();
  const [range, setRange] = useState<Range>('1h');
  const [stored, setStored] = useState<Point[] | null>(null);
  const [agentOk, setAgentOk] = useState<boolean | null>(null);

  // Probe once whether the Guardian agent is reachable (enables 24h / 7d).
  useEffect(() => {
    guardian.me().then(() => setAgentOk(true), () => setAgentOk(false));
  }, []);

  useEffect(() => {
    if (range === '1h') return;
    let alive = true;
    setStored(null);
    const load = () => guardian.history(range, ['cpu', 'mem']).then((h) => alive && setStored(toPoints(h.series))).catch(() => {});
    load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [range]);

  const points = range === '1h' ? history : stored ?? [];

  const view = useMemo(() => {
    if (points.length < 2) return null;
    const t1 = points[points.length - 1].t;
    const t0 = Math.max(points[0].t, t1 - SPAN[range]);
    const span = Math.max(t1 - t0, 60_000);
    const pts = points.filter((p) => p.t >= t0);
    const cpu = pathFor(pts, 'cpu', t0, span);
    const ram = pathFor(pts, 'ram', t0, span);
    const lastX = (((pts[pts.length - 1].t - t0) / span) * W).toFixed(1);
    const fmt = new Intl.DateTimeFormat(locale, range === '7d' ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false });
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: f * W, label: fmt.format(new Date(t0 + f * span)) }));
    return { cpu, ram, area: `${cpu} L${lastX},${H - PAD_B} L0,${H - PAD_B} Z`, ticks, last: pts[pts.length - 1] };
  }, [points, locale, range]);

  const tools = (
    <>
      <span className="legend">
        <span><i className="legend__sw" style={{ background: 'var(--accent)' }} />CPU</span>
        <span><i className="legend__sw" style={{ background: 'var(--violet)' }} />RAM</span>
      </span>
      {!compact && (
        <div className="segmented" role="tablist">
          {(['1h', '24h', '7d'] as const).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              disabled={r !== '1h' && agentOk === false}
              title={r !== '1h' && agentOk === false ? t('chart.needsGuardian') : undefined}
              onClick={() => setRange(r)}
              className={`segmented__btn${range === r ? ' segmented__btn--active' : ''}`}
            >
              {range === r && <motion.span layoutId="chart-range" className="segmented__pill" transition={m.spring} />}
              <span>{t(r === '1h' ? 'chart.1h' : r === '24h' ? 'chart.24h' : 'chart.7d')}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <Card title={t('card.chart')} tools={tools}>
      <div className="chart-box" style={compact ? { height: 170 } : undefined}>
        {!view ? (
          <Skel h={compact ? 170 : 240} r={12} />
        ) : (
          <svg key={range} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" role="img" aria-label={`CPU ${view.last.cpu.toFixed(0)}%, RAM ${view.last.ram.toFixed(0)}%`}>
            <defs>
              <linearGradient id="cpu-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
              </linearGradient>
              {/* lines "draw in" left→right by revealing them through a growing clip rect */}
              <clipPath id="chart-reveal">
                <motion.rect x="0" y="0" height={H} initial={{ width: m.off ? W : 0 }} animate={{ width: W }} transition={{ duration: m.dur(1.2), ease: [0.2, 0.8, 0.2, 1] }} />
              </clipPath>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2={W} y1={8 + f * (H - PAD_B - 8)} y2={8 + f * (H - PAD_B - 8)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            ))}
            <g clipPath="url(#chart-reveal)">
              <path d={view.area} fill="url(#cpu-fill)" />
              <path d={view.ram} fill="none" stroke="var(--violet)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <path d={view.cpu} fill="none" stroke="var(--accent)" strokeWidth={2.2} vectorEffect="non-scaling-stroke" />
            </g>
            {view.ticks.map((tk, i) => (
              <text key={i} x={Math.min(Math.max(tk.x, 18), W - 18)} y={H - 4} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
                fill="var(--text-subtle)" fontSize="11" fontFamily="var(--font-mono)">{tk.label}</text>
            ))}
          </svg>
        )}
      </div>
    </Card>
  );
}
