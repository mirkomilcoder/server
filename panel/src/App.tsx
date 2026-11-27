import { Suspense, useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { SettingsProvider, useSettings } from '@/state/settings';
import { SystemProvider, useSystem } from '@/state/system';
import { startAdmin, syncAdminMemory } from '@/api/superuser';
import { sessionUser } from '@/api/cockpit';
import { MetricsProvider } from '@/state/metrics';
import { GuardianProvider, useBrand } from '@/state/guardian';
import { ToastProvider, useToast } from '@/state/toasts';
import { I18nProvider, useT } from '@/i18n';
import { useApplyTheme } from '@/theme/theme';
import { useRoute } from '@/router';
import { modeById } from '@/modes';
import { CommandPalette } from '@/components/CommandPalette';
import { UpdateNotice } from '@/components/UpdateNotice';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Root() {
  const { settings, saveError } = useSettings();
  const { t } = useT();
  const toast = useToast();
  const { page, go } = useRoute(settings.startPage);
  const [palette, setPalette] = useState(false);
  const { brand } = useBrand();
  useEffect(() => {
    document.title = brand;
  }, [brand]);
  // Default: admin mode asks for the Linux password every time; "remember" re-enables it at login.
  const sysAdmin = useSystem().admin;
  useEffect(() => {
    if (sysAdmin !== null) syncAdminMemory(settings.rememberAdmin, sysAdmin);
  }, [settings.rememberAdmin, sysAdmin]);
  // signed in through Cloudflare (SSO account): turn admin mode on by itself — there is no password
  useEffect(() => {
    if (sysAdmin === false && sessionUser().name === 'mkadmin') {
      startAdmin(() => { /* no prompt expected */ }, true).catch(() => { /* panel still usable */ });
    }
  }, [sysAdmin]);
  useApplyTheme(settings);

  // Ctrl+K / Cmd+K opens the command palette from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (saveError) toast({ kind: 'error', title: t('settings.saveFailed'), details: saveError });
  }, [saveError, toast, t]);

  const Mode = modeById(settings.mode).component;
  return (
    <MotionConfig reducedMotion={settings.animations === 'on' ? 'user' : 'always'}>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <Mode page={page} go={go} openPalette={() => setPalette(true)} />
        </Suspense>
      </ErrorBoundary>
      <UpdateNotice />
      <CommandPalette open={palette} onClose={() => setPalette(false)} go={go} />
    </MotionConfig>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <I18nProvider>
        <ToastProvider>
          <SystemProvider>
            <MetricsProvider>
              <GuardianProvider>
                <Root />
              </GuardianProvider>
            </MetricsProvider>
          </SystemProvider>
        </ToastProvider>
      </I18nProvider>
    </SettingsProvider>
  );
}
