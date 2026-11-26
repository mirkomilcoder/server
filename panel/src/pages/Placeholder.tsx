import { Hourglass } from 'lucide-react';
import { useT } from '@/i18n';
import type { PageProps } from './registry';

/* Shown for pages whose milestone hasn't landed yet. */
export function placeholderFor(milestone: string) {
  return function Placeholder(_props: PageProps) {
    const { t } = useT();
    return (
      <div className="card">
        <div className="empty">
          <div className="empty__icon">
            <Hourglass size={28} strokeWidth={1.8} />
          </div>
          <h2>{t('common.soon')}</h2>
          <p>{t('page.soon.body', { m: milestone })}</p>
        </div>
      </div>
    );
  };
}
