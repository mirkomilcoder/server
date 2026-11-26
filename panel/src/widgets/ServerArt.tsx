/*
 * Decorative server-rack illustration for the hero card (pure SVG, no image
 * files, follows the accent color). Three racks in perspective with blinking
 * activity LEDs; the LEDs respect reduced-motion via CSS (.art-led).
 */
export function ServerArt() {
  const racks = [
    { x: 150, y: 34, w: 92, h: 196, depth: 26 },
    { x: 248, y: 14, w: 104, h: 226, depth: 30 },
    { x: 360, y: 46, w: 84, h: 184, depth: 24 },
  ];
  return (
    <svg className="server-art" viewBox="0 0 470 250" preserveAspectRatio="xMaxYMax meet" aria-hidden>
      <defs>
        <linearGradient id="art-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 34%, #0b1530)' }} />
          <stop offset="1" style={{ stopColor: '#070d1f' }} />
        </linearGradient>
        <linearGradient id="art-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 22%, #081024)' }} />
          <stop offset="1" style={{ stopColor: '#050a18' }} />
        </linearGradient>
        <radialGradient id="art-glow" cx="0.55" cy="0.6" r="0.6">
          <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.32 }} />
          <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="art-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.18 }} />
          <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>

      <ellipse cx="300" cy="150" rx="240" ry="130" fill="url(#art-glow)" />
      {/* perspective floor grid */}
      <g className="art-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`h${i}`} x1={60 + i * 8} y1={232 + i * 3} x2={470} y2={232 + i * 3} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={120 + i * 46} y1={232} x2={90 + i * 52} y2={252} />
        ))}
      </g>
      <rect x="110" y="230" width="360" height="22" fill="url(#art-floor)" />

      {racks.map((r, ri) => (
        <g key={ri}>
          {/* side face */}
          <path d={`M${r.x + r.w},${r.y} l${r.depth},-${r.depth * 0.45} v${r.h} l-${r.depth},${r.depth * 0.45} Z`} fill="url(#art-side)" stroke="rgba(148,163,184,.14)" />
          {/* top face */}
          <path d={`M${r.x},${r.y} l${r.depth},-${r.depth * 0.45} h${r.w} l-${r.depth},${r.depth * 0.45} Z`} style={{ fill: 'color-mix(in srgb, var(--accent) 18%, #0c1730)' }} stroke="rgba(148,163,184,.16)" />
          {/* front face */}
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="3" fill="url(#art-front)" stroke="rgba(148,163,184,.18)" />
          {/* server units */}
          {Array.from({ length: Math.floor((r.h - 16) / 22) }, (_, i) => {
            const uy = r.y + 10 + i * 22;
            return (
              <g key={i}>
                <rect x={r.x + 8} y={uy} width={r.w - 16} height={16} rx="2" fill="rgba(2,6,23,.55)" stroke="rgba(148,163,184,.10)" />
                <rect x={r.x + 14} y={uy + 6} width={r.w * 0.38} height={3} rx="1.5" style={{ fill: 'color-mix(in srgb, var(--accent) 55%, transparent)' }} />
                <circle className="art-led" cx={r.x + r.w - 18} cy={uy + 8} r="2.1" fill="var(--accent)" style={{ animationDelay: `${((i * 7 + ri * 3) % 11) * 0.23}s` }} />
                <circle cx={r.x + r.w - 26} cy={uy + 8} r="2.1" fill={i % 3 === 0 ? '#34D399' : 'rgba(148,163,184,.35)'} />
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
