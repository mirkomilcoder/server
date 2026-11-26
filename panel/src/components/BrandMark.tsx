import { useId } from 'react';

/*
 * Mirkomil logo: three stacked layers (a server stack seen in perspective)
 * on an accent gradient tile. Pure SVG, follows the accent color.
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  // useId() returns ':r1:' — colons break url(#…) references in SVG
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className="brand-mark">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--accent) 70%, #fff)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--accent) 75%, #1e1b4b)' }} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${id}-bg)`} />
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round">
        <path d="M24 11 L37 17.5 L24 24 L11 17.5 Z" fill="rgba(255,255,255,.22)" />
        <path d="M11 24 L24 30.5 L37 24" opacity=".85" />
        <path d="M11 30.5 L24 37 L37 30.5" opacity=".6" />
      </g>
    </svg>
  );
}
