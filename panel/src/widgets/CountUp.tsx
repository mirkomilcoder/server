import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';
import { useMotion } from '@/theme/motion';

/* Number that animates from its previous value to the new one. */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const m = useMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (m.off || m.reduced) {
      setShown(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: m.dur(0.6),
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: setShown,
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, m]);

  return <>{shown.toFixed(decimals)}</>;
}
