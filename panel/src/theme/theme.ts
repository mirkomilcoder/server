import { useEffect } from 'react';
import type { Settings } from '@/api/settings';

/* Applies the visual settings to <html> as data attributes / CSS variables. */

/** Dark text on light accents, white on dark ones (WCAG relative luminance). */
export function onAccentColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.3 ? '#04212A' : '#FFFFFF';
}

const FONT_ZOOM = { s: 0.92, m: 1, l: 1.08 } as const;

export function useApplyTheme(s: Settings) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const theme = s.theme === 'auto' ? (media.matches ? 'light' : 'dark') : s.theme;
      root.dataset.theme = theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [s.theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', s.accent);
    root.style.setProperty('--on-accent', onAccentColor(s.accent));
    root.style.setProperty('--speed', String(s.animationSpeed));
    root.style.setProperty('--zoom', String(FONT_ZOOM[s.fontSize]));
    root.dataset.motion = s.animations;
  }, [s.accent, s.animationSpeed, s.fontSize, s.animations]);
}
