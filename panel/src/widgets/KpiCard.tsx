import type { ReactNode } from 'react';
import { Card } from './Card';
import { CountUp } from './CountUp';
import { Skel } from './Skeletons';

/* "Protsessor (CPU) — 23% — sparkline — 4 yadro · o'rtacha yuk 0.42" */
interface Props {
  label: string;
  value: number | null;
  decimals?: number;
  unit?: string;
  /** Sparkline or progress bar. */
  viz?: ReactNode;
  sub?: ReactNode;
}

export function KpiCard({ label, value, decimals = 0, unit, viz, sub }: Props) {
  return (
    <Card label={label}>
      <div className="card__label">{label}</div>
      {value === null ? (
        <>
          <Skel w="45%" h={34} r={10} />
          <div style={{ height: 14 }} />
          <Skel h={30} />
          <div style={{ height: 10 }} />
          <Skel w="70%" h={12} />
        </>
      ) : (
        <>
          <div className="kpi__value">
            <span className="kpi__num">
              <CountUp value={value} decimals={decimals} />
            </span>
            {unit && <span className="kpi__unit">{unit}</span>}
          </div>
          {viz}
          {sub && <div className="card__meta">{sub}</div>}
        </>
      )}
    </Card>
  );
}

export function Progress({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="progress kpi__viz" style={{ height: 8, marginTop: 13, marginBottom: 23 }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}
