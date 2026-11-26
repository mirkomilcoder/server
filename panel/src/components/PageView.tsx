import { Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/theme/motion';
import { pageById, pagesFor, type PageId } from '@/pages/registry';
import { useGuardian } from '@/state/guardian';
import { useT } from '@/i18n';
import { ErrorBoundary } from './ErrorBoundary';
import { CardSkeleton } from '@/widgets/Skeletons';

/* Renders the current page: lazy chunk + error boundary + fade/slide transition. */
export function PageView({ page, go }: { page: PageId; go: (id: PageId) => void }) {
  const m = useMotion();
  const def = pageById(page);
  const { t } = useT();
  const role = useGuardian().me?.role;
  const allowed = pagesFor(role).some((p) => p.id === page);
  const Page = def.component;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={page} variants={m.page} initial="hidden" animate="show" exit="exit">
        <ErrorBoundary resetKey={page}>
          <Suspense fallback={<CardSkeleton lines={6} />}>
            {allowed ? <Page go={go} /> : <div className="card"><div className="empty"><h2>{t(def.label)}</h2><p>{t('role.noAccess')}</p></div></div>}
          </Suspense>
        </ErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}
