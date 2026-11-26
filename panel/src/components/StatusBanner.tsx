import { useState } from 'react';
import { formatDuration, useT } from '@/i18n';
import { useSystem } from '@/state/system';
import { Modal } from './Modal';

/*
 * "Server onlayn — hammasi joyida" strip. Tailscale and the internet watchdog
 * items appear once their data sources land (M6 / M4); until then they're hidden
 * rather than showing fake values.
 */
export function StatusBanner() {
  const { t } = useT();
  const sys = useSystem();
  const [adminInfo, setAdminInfo] = useState(false);

  return (
    <section className="banner" aria-live="polite">
      <div className="banner__status">
        <span className="dot dot--success dot--live" aria-hidden />
        {t('banner.ok')}
      </div>
      <div className="banner__item">
        {t('banner.uptime')}: <b>{sys.uptimeSec === null ? '…' : formatDuration(t, sys.uptimeSec)}</b>
      </div>
      <div className="banner__end">
        {sys.admin !== null && (
          <button
            className={`pill ${sys.admin ? 'pill--warning' : 'pill--muted'}`}
            onClick={() => setAdminInfo(true)}
          >
            {t(sys.admin ? 'banner.admin.on' : 'banner.admin.off')}
          </button>
        )}
      </div>
      <Modal
        open={adminInfo}
        onClose={() => setAdminInfo(false)}
        title={t('admin.title')}
        actions={
          <button className="btn" onClick={() => setAdminInfo(false)}>
            {t('common.close')}
          </button>
        }
      >
        {t(sys.admin ? 'admin.on' : 'admin.off')}
      </Modal>
    </section>
  );
}
