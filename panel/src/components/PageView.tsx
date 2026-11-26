import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/theme/motion';
import { pageById, type PageId } from '@/pages/registry';
import { ErrorBoundary } from './ErrorBoundary';
import { CardSkeleton } from '@/widgets/Skeletons';

/* Renders the current page: lazy chunk + error boundary + fade/slide transition. */
export function PageView({ page, go }: { page: PageId; go: (id: PageId) => void }) {
  const m = useMotion();
  const def = pageById(page);
  const Page = def.component;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={page} variants={m.page} initial="hidden" animate="show" exit="exit">
        <ErrorBoundary resetKey={page}>
          <Suspense fallback={<CardSkeleton lines={6} />}>
            <Page go={go} />
          </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}
