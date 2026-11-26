import { Cloud, Globe, Home, Lock, Waypoints, Wifi } from 'lucide-react';
import { tunnel, type TunnelStatus } from '@/api/guardian';
import { usePoll } from '@/hooks/usePoll';
import { useT } from '@/i18n';
import { useGuardian } from '@/state/guardian';
import { Card, MotionGrid } from '@/widgets/Card';
import type { PageProps } from './registry';

/*
 * How the server is reachable. Nothing listens publicly: LAN and Tailscale
 * reach Cockpit directly, the internet only through the outbound Cloudflare Tunnel.
 */

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function Path({ icon, title, sub, state, tone }: { icon: React.ReactNode; title: string; sub: React.ReactNode; state: string; tone: Tone }) {
  return (
    <div className="net-path">
      <span className={`title-icon tint--${tone === 'neutral' ? 'info' : tone}`}>{icon}</span>
      <div>
        <div className="net-path__title">{title}</div>
        <div className="net-path__sub">{sub}</div>
      </div>
      <span className={`pill${tone === 'neutral' ? '' : ` pill--${tone}`}`}>{state}</span>
    </div>
  );
}

export default function NetworkPage({ go }: PageProps) {
  const { t } = useT();
  const { status, me } = useGuardian();
  const isAdmin = me?.role === 'admin';
  const tun = usePoll(() => (isAdmin ? tunnel.status() : Promise.resolve<TunnelStatus>({ configured: false })), 20_000, [isAdmin]);
  const check = (id: string) => status?.checks.find((c) => c.id === id);
  const internet = check('internet');
  const dns = check('dns');
  const tt = tun.data;
  const tunOk = tt?.configured && tt.status === 'healthy' && tt.service === 'active';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.network')}</h1>
          <p className="muted">{t('net.intro')}</p>
        </div>
      </div>
      <MotionGrid className="grid grid--bottom">
        <Card title={<><span className="title-icon tint--info"><Waypoints size={17} /></span>{t('net.paths')}</>}>
          <div className="net-map">
            <Path icon={<Globe size={17} />} title={t('net.internet')} sub={internet?.title ?? '—'}
              state={internet ? (internet.severity === 'ok' ? t('net.ok') : t('net.problem')) : '—'}
              tone={!internet ? 'neutral' : internet.severity === 'ok' ? 'success' : 'danger'} />
            <Path icon={<Wifi size={17} />} title="DNS" sub={dns?.title ?? '—'}
              state={dns ? (dns.severity === 'ok' ? t('net.ok') : t('net.problem')) : '—'}
              tone={!dns ? 'neutral' : dns.severity === 'ok' ? 'success' : 'danger'} />
            <Path icon={<Home size={17} />} title={t('net.lan')}
              sub={<span className="mono">{status?.ip ? `https://${status.ip}:9090` : '—'}</span>}
              state={status?.ip ? t('net.lanOnly') : '—'} tone={status?.ip ? 'success' : 'neutral'} />
            <Path icon={<Lock size={17} />} title="Tailscale"
              sub={<span className="mono">{status?.tailscale_ip ? `https://${status.tailscale_ip}:9090` : t('net.tsOff')}</span>}
              state={status?.tailscale_ip ? t('net.private') : t('net.off')} tone={status?.tailscale_ip ? 'success' : 'warning'} />
            <Path icon={<Cloud size={17} />} title="Cloudflare Tunnel"
              sub={tt?.configured ? <span className="mono">https://{tt.panel_host}</span> : isAdmin ? t('net.cfOff') : t('identity.adminOnly')}
              state={tt?.configured ? (tunOk ? t('net.ok') : t('net.problem')) : t('net.off')}
              tone={tt?.configured ? (tunOk ? 'success' : 'danger') : 'neutral'} />
          </div>
        </Card>
        <Card title={<><span className="title-icon tint--success"><Lock size={17} /></span>{t('net.why')}</>}>
          <ul className="howto">
            <li>{t('net.why1')}</li>
            <li>{t('net.why2')}</li>
            <li>{t('net.why3')}</li>
          </ul>
          <div className="row-gap" style={{ marginTop: 14 }}>
            <button className="btn btn--sm" onClick={() => go('domains')}>{t('nav.domains')}</button>
            <button className="btn btn--sm btn--ghost" onClick={() => go('security')}>{t('nav.security')}</button>
          </div>
        </Card>
      </MotionGrid>
    </>
  );
}
