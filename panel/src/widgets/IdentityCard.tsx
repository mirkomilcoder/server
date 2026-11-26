import { useEffect, useState } from 'react';
import { Globe, Server } from 'lucide-react';
import { guardian } from '@/api/guardian';
import { useT } from '@/i18n';
import { useBrand, useGuardian } from '@/state/guardian';
import { useToast } from '@/state/toasts';
import { Card } from './Card';

/*
 * Server display name + hosting domain. Saved through Guardian (admin only,
 * checked server-side) → root helper → /etc/mirkomil/config.env, then the
 * installer re-renders the login page and Cockpit config. Same validation
 * rules as installer/lib/common.sh (valid_brand / valid_domain).
 */
const BRAND_RE = /^[^"\\<>{};`$\x00-\x1f\x7f]{2,40}$/;
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function IdentityCard() {
  const { t } = useT();
  const toast = useToast();
  const { brand, domain } = useBrand();
  const { me, available } = useGuardian();
  const [name, setName] = useState(brand);
  const [dom, setDom] = useState(domain);
  const [busy, setBusy] = useState(false);
  const isAdmin = me?.role === 'admin';

  // follow the server value until the user starts editing
  useEffect(() => setName(brand), [brand]);
  useEffect(() => setDom(domain), [domain]);

  const nameOk = BRAND_RE.test(name) && name.trim() === name;
  const domOk = DOMAIN_RE.test(dom);
  const changed = name !== brand || dom !== domain;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameOk || !domOk) return;
    setBusy(true);
    try {
      await guardian.setIdentity(name, dom);
      toast({ kind: 'success', title: t('identity.saved') });
    } catch (err) {
      toast({ kind: 'error', title: t('action.failed'), details: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('identity.title')}>
      <form onSubmit={save} className="identity-form">
        <p className="card__meta" style={{ fontSize: 13, marginBottom: 14 }}>{t('identity.intro')}</p>
        <label className="field">
          <span className="field__label">{t('identity.name')}</span>
          <span className="input-wrap">
            <Server size={17} aria-hidden />
            <input className="input" value={name} maxLength={40} disabled={!isAdmin || busy}
              onChange={(e) => setName(e.target.value)} aria-invalid={!nameOk} />
          </span>
          {!nameOk && <span className="form-error">{t('identity.invalidName')}</span>}
        </label>
        <label className="field" style={{ marginTop: 14 }}>
          <span className="field__label">{t('identity.domain')}</span>
          <span className="input-wrap">
            <Globe size={17} aria-hidden />
            <input className="input mono" value={dom} maxLength={253} disabled={!isAdmin || busy}
              onChange={(e) => setDom(e.target.value.trim().toLowerCase())} aria-invalid={!domOk} />
          </span>
          {domOk ? (
            <span className="card__meta">{t('identity.domainHint', { d: dom })}</span>
          ) : (
            <span className="form-error">{t('identity.invalidDomain')}</span>
          )}
        </label>
        <div className="modal__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card__meta">{!isAdmin && available !== false ? t('identity.adminOnly') : ''}</span>
          <button className="btn btn--accent" type="submit" disabled={!isAdmin || busy || !changed || !nameOk || !domOk}>
            {busy ? t('identity.saving') : t('identity.save')}
          </button>
        </div>
      </form>
    </Card>
  );
}
