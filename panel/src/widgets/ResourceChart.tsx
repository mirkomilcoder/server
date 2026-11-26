import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { useT, type TranslationKey } from '@/i18n';
import { useMetrics, type Point } from '@/state/metrics';
import { useMotion } from '@/theme/motion';
import { guardian } from '@/api/guardian';
import { Card } from './Card';
import { Skel } from './Skeletons';

/*
 * Resource chart (plain SVG, no chart library):
 *  - CPU, RAM, Disk in %; Network relative to its peak in the range (tooltip shows Mbit/s)
 *  - 1 soat: live samples kept in the browser (works without the agent)
 *  - 6 / 24 soat, 7 kun: history stored by the Guardian agent (SQLite)
 *  - hover → crosshair + exact values; click a legend item → hide/show that series
 */

type Range = '1h' | '6h' | '24h' | '7d';
type Key = 'cpu' | 'ram' | 'disk' | 'net';

const W = 1000;
const H = 260;
const PAD = { l: 44, r: 12, t: 12, b: 28 };
const SPAN: Record<Range, number> = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 86400e3, '7d': 7 * 86400e3 };
const RANGE_LABEL: Record<Range, TranslationKey> = { '1h': 'chart.1h', '6h': 'chart.6h', '24h': 'chart.24h', '7d': 'chart.7d' };
const SERIES: { key: Key; label: string; color: string }[] = [
  { key: 'cpu', label: 'CPU', color: 'var(--c-cpu)' },
  { key: 'ram', label: 'RAM', color: 'var(--c-ram)' },
  { key: 'disk', label: 'Disk', color: 'var(--c-disk)' },
  { key: 'net', label: 'Net', color: 'var(--c-net)' },
];

/** Smooth line through points (Catmull-Rom → cubic Bézier), control points clamped to the plot. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  const clampY = (y: number) => Math.min(H - PAD.b, Math.max(PAD.t, y));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] ?? pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] ?? pts[i + 1];
    const c1x = x1 + (x2 - x0) / 6, c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6, c2y = y2 - (y3 - y1) / 6;
    d += ` C${c1x.toFixed(1)},${clampY(c1y).toFixed(1)} ${c2x.toFixed(1)},${clampY(c2y).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

/** Guardian series → Point[] (mem→ram, rx+tx bits/s → Mbit/s). */
function toPoints(series: Record<string, [number, number][]>): Point[] {
  const idx = (k: string) => new Map((series[k] ?? []).map(([ts, v]) => [ts, v]));
  const mem = idx('mem'), disk = idx('disk'), rx = idx('rx_bps'), tx = idx('tx_bps');
  return (series.cpu ?? []).map(([ts, v]) => ({
    t: ts * 1000,
    cpu: v,
    ram: mem.get(ts) ?? 0,
    disk: disk.get(ts) ?? 0,
    net: ((rx.get(ts) ?? 0) + (tx.get(ts) ?? 0)) / 1e6,
  }));
}

export function ResourceChart({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useT();
  const { history } = useMetrics();
  const m = useMotion();
  const [range, setRange] = useState<Range>('1h');
  const [stored, setStored] = useState<Point[] | null>(null);
  const [agentOk, setAgentOk] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState<Set<Key>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    guardian.me().then(() => setAgentOk(true), () => setAgentOk(false));
  }, []);

  useEffect(() => {
    if (range === '1h') return;
    let alive = true;
    setStored(null);
    const load = () =>
      guardian
        .history(range === '6h' ? '24h' : range, ['cpu', 'mem', 'disk', 'rx_bps', 'tx_bps'])
        .then((h) => alive && setStored(toPoints(h.series)))
        .catch(() => alive && setStored([]));
    load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [range]);

  const points = range === '1h' ? history : stored ?? [];

  const view = useMemo(() => {
    if (points.length < 2) return null;
    const t1 = points[points.length - 1].t;
    const t0 = Math.max(points[0].t, t1 - SPAN[range]);
    // use the full width for whatever data exists (a fresh page has only seconds of it)
    const span = Math.max(t1 - t0, 1_000);
    const pts = points.filter((p) => p.t >= t0);
    if (pts.length < 2) return null;
    const netMax = Math.max(...pts.map((p) => p.net), 0.001);
    const x = (tm: number) => PAD.l + ((tm - t0) / span) * (W - PAD.l - PAD.r);
    const y = (pct: number) => H - PAD.b - (Math.min(100, Math.max(0, pct)) / 100) * (H - PAD.t - PAD.b);
    const val = (p: Point, k: Key) => (k === 'net' ? (p.net / netMax) * 100 : p[k]);
    const paths = Object.fromEntries(SERIES.map((s) => [s.key, smooth(pts.map((p) => [x(p.t), y(val(p, s.key))]))])) as Record<Key, string>;
    const fmt = new Intl.DateTimeFormat(locale, range === '7d' ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false });
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: x(t0 + f * span), label: fmt.format(new Date(t0 + f * span)) }));
    return { pts, x, y, val, paths, ticks, fmt };
  }, [points, locale, range]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!view || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < view.pts.length; i++) {
      if (Math.abs(view.x(view.pts[i].t) - sx) < Math.abs(view.x(view.pts[best].t) - sx)) best = i;
    }
    setHover(best);
  };

  const toggle = (k: Key) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else if (n.size < SERIES.length - 1) n.add(k); // always keep at least one series
      return n;
    });

  const ranges: Range[] = ['1h', '6h', '24h', '7d'];
  const hp = hover !== null && view ? view.pts[hover] : null;
  const last = view?.pts[view.pts.length - 1];

  return (
    <Card
      className="chart-card"
      title={<><span className="title-icon tint--accent"><BarChart3 size={17} /></span>{t('card.chart')}</>}
      tools={
        !compact && (
          <div className="segmented segmented--sm" role="tablist">
            {ranges.map((r) => {
              const disabled = r !== '1h' && agentOk === false;
              return (
                <button key={r} role="tab" aria-selected={range === r} disabled={disabled}
                  title={disabled ? t('chart.needsGuardian') : undefined}
                  className={`segmented__btn${range === r ? ' segmented__btn--active' : ''}`}
                  onClick={() => { setRange(r); setHover(null); }}>
                  {range === r && <motion.span layoutId="chart-range" className="segmented__pill segmented__pill--accent" transition={m.spring} />}
                  <span>{t(RANGE_LABEL[r])}</span>
                </button>
              );
            })}
          </div>
        )
      }
    >
      <div className="chart-legend">
        {SERIES.map((s) => (
          <button key={s.key} className={`legend-item${hidden.has(s.key) ? ' is-off' : ''}`} onClick={() => toggle(s.key)}
            aria-pressed={!hidden.has(s.key)} title={s.key === 'net' ? t('chart.net.note') : undefined}>
            <i style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="chart-box" style={compact ? { height: 180 } : undefined}>
        {!view || !last ? (
          <Skel h={compact ? 180 : 260} r={12} />
        ) : (
          <>
            <svg ref={svg} key={range} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%"
              onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
              aria-label={`CPU ${last.cpu.toFixed(0)}%, RAM ${last.ram.toFixed(0)}%, Disk ${last.disk.toFixed(0)}%`}>
              <defs>
                <clipPath id="chart-reveal">
                  <motion.rect x="0" y="0" height={H} initial={{ width: m.off ? W : 0 }} animate={{ width: W }}
                    transition={{ duration: m.dur(1.1), ease: [0.2, 0.8, 0.2, 1] }} />
                </clipPath>
                <linearGradient id="cpu-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" style={{ stopColor: 'var(--c-cpu)', stopOpacity: 0.22 }} />
                  <stop offset="1" style={{ stopColor: 'var(--c-cpu)', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={view.y(v)} y2={view.y(v)} className="chart-grid" vectorEffect="non-scaling-stroke" />
                  <text x={PAD.l - 10} y={view.y(v) + 4} textAnchor="end" className="chart-axis">{v}%</text>
                </g>
              ))}
              {view.ticks.map((tk, i) => (
                <text key={i} x={tk.x} y={H - 6} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="chart-axis">{tk.label}</text>
              ))}
              <g clipPath="url(#chart-reveal)">
                {!hidden.has('cpu') && (
                  <path d={`${view.paths.cpu} L${view.x(last.t)},${H - PAD.b} L${PAD.l},${H - PAD.b} Z`} fill="url(#cpu-area)" />
                )}
                {SERIES.slice().reverse().filter((s) => !hidden.has(s.key)).map((s) => (
                  <path key={s.key} d={view.paths[s.key]} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinecap="round"
                    className="chart-line" style={{ color: s.color }} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              {hp && (
                <g>
                  <line x1={view.x(hp.t)} x2={view.x(hp.t)} y1={PAD.t} y2={H - PAD.b} className="chart-cross" vectorEffect="non-scaling-stroke" />
                  {SERIES.filter((s) => !hidden.has(s.key)).map((s) => (
                    <circle key={s.key} cx={view.x(hp.t)} cy={view.y(view.val(hp, s.key))} r={4.5} fill="var(--surface)" stroke={s.color} strokeWidth={2.2} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              )}
            </svg>
            {hp && (
              <div className="chart-tip" style={{ left: `${(view.x(hp.t) / W) * 100}%` }} data-flip={view.x(hp.t) > W * 0.65 ? '' : undefined}>
                <div className="chart-tip__time">{view.fmt.format(new Date(hp.t))}</div>
                {SERIES.filter((s) => !hidden.has(s.key)).map((s) => (
                  <div key={s.key} className="chart-tip__row">
                    <i style={{ background: s.color }} />
                    {s.label}
                    <b>{s.key === 'net' ? `${hp.net.toFixed(1)} Mbit/s` : `${hp[s.key].toFixed(0)}%`}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
