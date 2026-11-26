import { Bot, Plus } from 'lucide-react';
import { apps } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT, type TranslationKey } from '@/i18n';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import { timeAgo } from '@/widgets/home';
import { appState } from './DeployPage';
import type { PageProps } from './registry';

/*
 * Bots = projects of type "bot" (aiogram etc.), deployed like any other app
 * in a hardened container. Details/management live on the Deploy page.
 */
export default function BotsPage({ go }: PageProps) {
  const { t } = useT();
  const list = usePoll(apps.list, 8000);
  const bots = (list.data?.apps ?? []).filter((a) => (a.current?.type ?? a.last_deploy?.type ?? a.type) === 'bot');
  const label: Record<ReturnType<typeof appState>, TranslationKey> = { running: 'deploy.running', deploying: 'deploy.deploying', failed: 'deploy.failed', never: 'deploy.never' };
  const pill = { running: 'pill--success', deploying: 'pill--info', failed: 'pill--danger', never: 'pill--muted' } as const;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.bots')}</h1>
          <p className="muted">{t('type.bot')}</p>
        </div>
        <button className="btn btn--accent" onClick={() => go('deploy')}><Plus size={16} /> {t('deploy.new')}</button>
      </div>
      <MotionGrid className="grid">
        <Card>
          {!list.data ? <RowsSkeleton rows={3} h={48} /> : bots.length === 0 ? (
            <div className="empty empty--compact">
              <div className="empty__icon"><Bot size={24} /></div>
              <h2>{t('deploy.empty.title')}</h2>
              <p>{t('deploy.empty.body')}</p>
            </div>
          ) : bots.map((b) => {
            const st = appState(b);
            return (
              <div className="row" key={b.name}>
                <span className={`dot dot--${st === 'running' ? 'success' : st === 'failed' ? 'danger' : 'warning'}${st === 'running' ? ' dot--live' : ''}`} />
                <div className="row__main">
                  <div className="row__name">{b.name}</div>
                  <div className="row__meta">{b.last_deploy ? `${timeAgo(t, b.last_deploy.started)} · ${b.last_deploy.commit ?? ''}` : t('deploy.never')}</div>
                </div>
                <span className={`pill ${pill[st]}`}>{t(label[st])}</span>
                <button className="btn btn--sm btn--ghost" onClick={() => go('deploy', { app: b.name })}>{t('deploy.details')} →</button>
              </div>
            );
          })}
        </Card>
      </MotionGrid>
    </>
  );
}
