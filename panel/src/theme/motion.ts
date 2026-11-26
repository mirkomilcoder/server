import { useMemo } from 'react';
import { useReducedMotion, type Transition, type Variants } from 'framer-motion';
import { useSettings } from '@/state/settings';

/*
 * Shared motion presets. Everything goes through here so the "animations"
 * setting, the speed slider and the OS "reduce motion" preference apply everywhere.
 */

export const EASE = [0.2, 0.8, 0.2, 1] as const;

export function useMotion() {
  const { settings } = useSettings();
  const osReduced = useReducedMotion();
  const off = settings.animations === 'off';
  const reduced = off || settings.animations === 'reduced' || !!osReduced;
  const k = 1 / settings.animationSpeed;

  return useMemo(() => {
    const dur = (s: number) => (off ? 0 : s * k);
    const rise = reduced ? 0 : 16;

    /** Parent grid: staggers its children by 50ms. */
    const stagger: Variants = {
      hidden: {},
      show: { transition: { staggerChildren: off ? 0 : 0.05 * k } },
    };
    /** Card / tile entrance: fade + rise. */
    const item: Variants = {
      hidden: { opacity: 0, y: rise },
      show: { opacity: 1, y: 0, transition: { duration: dur(0.65), ease: EASE } },
    };
    const page: Variants = {
      hidden: { opacity: 0, y: reduced ? 0 : 8 },
      show: { opacity: 1, y: 0, transition: { duration: dur(0.2), ease: EASE } },
      exit: { opacity: 0, transition: { duration: dur(0.12) } },
    };
    const spring: Transition = off ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 };

    return {
      off,
      reduced,
      dur,
      stagger,
      item,
      page,
      spring,
      /** Card hover lift (disabled when motion is reduced). */
      cardHover: reduced ? undefined : { y: -3 },
      tileHover: reduced ? undefined : { y: -6, scale: 1.02 },
      tileTap: reduced ? undefined : { scale: 0.97 },
    };
  }, [off, reduced, k]);
}
