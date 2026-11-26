import type { ReactNode } from 'react';
import { useT, type TranslationKey } from '@/i18n';
import { useSettings } from '@/state/settings';
import { ACCENT_PRESETS, type Settings } from '@/api/settings';
import { MODES } from '@/modes';
import { Card, MotionGrid } from '@/widgets/Card';
import { PAGES } from './registry';
import type { PageProps } from './registry';

/*
 * Settings (M2 subset): mode, theme, accent, animations, language, refresh,
 * font size, start page. Widget order (dnd), import/export and reset land in M9.
 */

function Choices<K extends keyof Settings>({ k, options }: { k: K; options: { value: Settings[K]; label: string }[] }) {
  const { settings, update } = useSettings();
  return (
    <div className="choices">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className="choice"
          aria-pressed={settings[k] === o.value}
          onClick={() => update({ [k]: o.value } as Partial<Settings>)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      {children}
    </div>
  );
}

export default function SettingsPage(_props: PageProps) {
  const { t } = useT();
  const { settings, update } = useSettings();
  const tk = (k: string) => t(k as TranslationKey);

  return (
    <>
      <div className="page-head">
        <h1>{t('settings.title')}</h1>
      </div>
      <MotionGrid className="form-grid">
        <Card title={t('settings.mode')}>
          <Choices k="mode" options={MODES.map((m) => ({ value: m.id, label: t(m.label) }))} />
        </Card>

        <Card title={t('settings.theme')}>
          <div style={{ display: 'grid', gap: 18 }}>
            <Choices k="theme" options={(['dark', 'light', 'auto'] as const).map((v) => ({ value: v, label: tk(`settings.theme.${v}`) }))} />
            <Field label={t('settings.accent')}>
              <div className="choices">
                {ACCENT_PRESETS.map((c) => (
                  <button key={c} className="swatch" style={{ background: c }} aria-label={c} aria-pressed={settings.accent.toUpperCase() === c} onClick={() => update({ accent: c })} />
                ))}
                <input
                  type="color"
                  className="swatch"
                  aria-label={t('settings.accent.custom')}
                  title={t('settings.accent.custom')}
                  value={settings.accent}
                  onChange={(e) => update({ accent: e.target.value.toUpperCase() })}
                />
              </div>
            </Field>
          </div>
        </Card>

        <Card title={t('settings.animations')}>
          <div style={{ display: 'grid', gap: 18 }}>
            <Choices k="animations" options={(['on', 'reduced', 'off'] as const).map((v) => ({ value: v, label: tk(`settings.animations.${v}`) }))} />
            <Field label={`${t('settings.speed')}: ${settings.animationSpeed.toFixed(1)}×`}>
              <input type="range" min={0.5} max={2} step={0.1} value={settings.animationSpeed} onChange={(e) => update({ animationSpeed: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>

        <Card title={t('settings.language')}>
          <Choices k="language" options={[{ value: 'uz', label: "O'zbekcha" }, { value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} />
        </Card>

        <Card title={t('settings.refresh')}>
          <Choices k="refreshMs" options={([2000, 5000, 10000, 30000] as const).map((v) => ({ value: v, label: `${v / 1000} s` }))} />
        </Card>

        <Card title={t('settings.fontSize')}>
          <Choices k="fontSize" options={[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }]} />
        </Card>

        <Card title={t('settings.startPage')}>
          <Choices k="startPage" options={PAGES.filter((p) => !p.danger).map((p) => ({ value: p.id, label: t(p.label) }))} />
        </Card>
      </MotionGrid>
    </>
  );
}
