import { useMemo, useState } from 'react';
import { FileText, Play, Power, RotateCw, Search, Square, ToggleLeft } from 'lucide-react';
import { runAction } from '@/api/run';
import type { ActionId } from '@/api/actions';
import { usePoll } from '@/hooks/usePoll';
import { useAction } from '@/hooks/useAction';
import { useT, type TranslationKey } from '@/i18n';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, MotionGrid } from '@/widgets/Card';
import { RowsSkeleton } from '@/widgets/Skeletons';
import type { PageProps } from './registry';

/*
 * All systemd services: search, filter, state, boot setting, actions.
 * Reads are unprivileged; start/stop/restart/enable/disable need admin mode
 * (Cockpit superuser) and stop/restart/disable ask for confirmation.
 */

interface Unit {
  unit: string;
  description: string;
  active: string;
  sub: string;
  load: string;
  file?: string; // enabled | disabled | static | …
}

async function loadUnits(): Promise<Unit[]> {
  const [units, files] = await Promise.all([runAction('services.list', {}), runAction('services.files', {})]);
  const fileState = new Map<string, string>(
    (JSON.parse(files) as { unit_file: string; state: string }[]).map((f) => [f.unit_file, f.state]),
  );
  return (JSON.parse(units) as Unit[])
    .filter((u) => u.load !== 'not-found' && !u.unit.includes('@.'))
    .map((u) => ({ ...u, file: fileState.get(u.unit) }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

type Filter = 'all' | 'active' | 'failed' | 'inactive';
type Pending = { id: ActionId; unit: string; body: TranslationKey; label: TranslationKey } | null;

function StatePill({ u }: { u: Unit }) {
  const { t } = useT();
  if (u.active === 'active') return <span className="pill pill--success">{t('svc.active')}</span>;
  if (u.active === 'failed') return <span className="pill pill--danger">{t('svc.failed')}</span>;
  if (u.active === 'activating' || u.active === 'reloading') return <span className="pill pill--info">{t('svc.activating')}</span>;
  return <span className="pill pill--muted">{t('svc.inactive')}</span>;
}

export default function ServicesPage({ go }: PageProps) {
  const { t } = useT();
  const { run, busy, isAdmin } = useAction();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<Pending>(null);
  const [tick, setTick] = useState(0);
  const data = usePoll(loadUnits, 10_000, [tick]);

  const units = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.data ?? []).filter((u) => {
      if (filter === 'active' && u.active !== 'active') return false;
      if (filter === 'failed' && u.active !== 'failed') return false;
      if (filter === 'inactive' && u.active !== 'inactive') return false;
      return !needle || u.unit.toLowerCase().includes(needle) || u.description.toLowerCase().includes(needle);
    });
  }, [data.data, q, filter]);

  const counts = useMemo(() => {
    const all = data.data ?? [];
    return {
      all: all.length,
      active: all.filter((u) => u.active === 'active').length,
      failed: all.filter((u) => u.active === 'failed').length,
      inactive: all.filter((u) => u.active === 'inactive').length,
    };
  }, [data.data]);

  const act = async (id: ActionId, unit: string) => {
    const out = await run(id as 'service.start', { unit }, { success: t('svc.done', { unit }) });
    if (out !== null) setTick((x) => x + 1);
  };

  const ask = (id: ActionId, unit: string, body: TranslationKey, label: TranslationKey) =>
    isAdmin ? setPending({ id, unit, body, label }) : act(id, unit);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('services.title')}</h1>
          <p className="muted">{t('services.count', { n: counts.all })}</p>
        </div>
        <span className="input-wrap search-input">
          <Search size={17} aria-hidden />
          <input className="input" placeholder={t('services.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
      </div>

      <div className="chips" role="tablist">
        {(['all', 'active', 'failed', 'inactive'] as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`chip${filter === f ? ' chip--on' : ''}${f === 'failed' && counts.failed ? ' chip--danger' : ''}`} onClick={() => setFilter(f)}>
            {t(`services.filter.${f}` as TranslationKey)} <span className="chip__n">{counts[f]}</span>
          </button>
        ))}
      </div>

      <MotionGrid className="grid">
        <Card>
          {!data.data ? (
            <RowsSkeleton rows={8} h={44} />
          ) : units.length === 0 ? (
            <p className="muted" style={{ padding: 20, textAlign: 'center' }}>{t('services.empty')}</p>
          ) : (
            <div className="svc-table" role="table">
              {units.map((u) => {
                const running = u.active === 'active' || u.active === 'activating';
                const canToggleBoot = u.file === 'enabled' || u.file === 'disabled';
                return (
                  <div className="svc-row" role="row" key={u.unit}>
                    <div className="svc-row__name" role="cell">
                      <span className="mono">{u.unit.replace(/\.service$/, '')}</span>
                      <span className="svc-row__desc">{u.description}</span>
                    </div>
                    <div role="cell"><StatePill u={u} /></div>
                    <div role="cell" className="svc-row__boot">
                      {u.file === 'enabled' ? t('svc.enabled') : u.file === 'disabled' ? t('svc.disabled') : u.file === 'static' ? t('svc.static') : u.file ?? '—'}
                    </div>
                    <div className="svc-row__actions" role="cell">
                      {running ? (
                        <>
                          <button className="icon-btn" title={t('svc.restart')} aria-label={`${t('svc.restart')}: ${u.unit}`} disabled={!!busy}
                            onClick={() => ask('service.restart', u.unit, 'svc.confirm.restart', 'svc.restart')}><RotateCw size={16} /></button>
                          <button className="icon-btn" title={t('svc.stop')} aria-label={`${t('svc.stop')}: ${u.unit}`} disabled={!!busy}
                            onClick={() => ask('service.stop', u.unit, 'svc.confirm.stop', 'svc.stop')}><Square size={15} /></button>
                        </>
                      ) : (
                        <button className="icon-btn" title={t('svc.start')} aria-label={`${t('svc.start')}: ${u.unit}`} disabled={!!busy}
                          onClick={() => act('service.start', u.unit)}><Play size={16} /></button>
                      )}
                      {canToggleBoot && (
                        <button className="icon-btn" disabled={!!busy}
                          title={t(u.file === 'enabled' ? 'svc.disable' : 'svc.enable')}
                          aria-label={`${t(u.file === 'enabled' ? 'svc.disable' : 'svc.enable')}: ${u.unit}`}
                          onClick={() => (u.file === 'enabled' ? ask('service.disable', u.unit, 'svc.confirm.disable', 'svc.disable') : act('service.enable', u.unit))}>
                          {u.file === 'enabled' ? <Power size={16} /> : <ToggleLeft size={16} />}
                        </button>
                      )}
                      <button className="icon-btn" title={t('svc.logs')} aria-label={`${t('svc.logs')}: ${u.unit}`} onClick={() => go('logs', { unit: u.unit })}>
                        <FileText size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </MotionGrid>

      <ConfirmDialog
        open={!!pending}
        title={pending ? t(pending.label) : ''}
        body={pending ? t(pending.body, { unit: pending.unit }) : ''}
        confirmLabel={pending ? t(pending.label) : ''}
        tone={pending?.id === 'service.restart' ? 'warning' : 'danger'}
        busy={!!busy}
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await act(pending.id, pending.unit);
          setPending(null);
        }}
      />
    </>
  );
}
