import { Suspense, useEffect, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { SettingsProvider, useSettings } from '@/state/settings';
import { SystemProvider } from '@/state/system';
import { MetricsProvider } from '@/state/metrics';
import { ToastProvider, useToast } from '@/state/toasts';
import { I18nProvider, useT } from '@/i18n';
import { useApplyTheme } from '@/theme/theme';
import { useRoute } from '@/router';
import { modeById } from '@/modes';
import { CommandPalette } from '@/components/CommandPalette';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Root() {
  const { settings, saveError } = useSettings();
  const { t } = useT();
  const toast = useToast();
  const { page, go } = useRoute(settings.startPage);
  const [palette, setPalette] = useState(false);
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
              <Root />
            </MetricsProvider>
          </SystemProvider>
        </ToastProvider>
      </I18nProvider>
    </SettingsProvider>
  );
}
