import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/theme/motion';

/*
 * Base card used by every widget: staggered entrance (as a child of a
 * motion grid with variants "hidden"/"show") and a subtle hover lift.
 */
interface Props {
  title?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}

export function Card({ title, tools, children, className = '', label }: Props) {
  const m = useMotion();
  return (
    <motion.section
      className={`card card--hover ${className}`}
      variants={m.item}
      whileHover={m.cardHover}
      aria-label={label}
    >
      {(title || tools) && (
        <div className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {tools && <div className="card__tools">{tools}</div>}
        </div>
      )}
      {children}
    </motion.section>
  );
}

/** Grid wrapper that staggers its Card children in. */
export function MotionGrid({ className, children }: { className: string; children: ReactNode }) {
  const m = useMotion();
  return (
    <motion.div className={className} variants={m.stagger} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}
