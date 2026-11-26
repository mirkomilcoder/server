import { useCallback, useState } from 'react';
import { actionMeta, type ActionId, type ActionParams } from '@/api/actions';
import { ActionError, runAction, type RunOptions } from '@/api/run';
import { useT } from '@/i18n';
import { useSystem } from '@/state/system';
import { useToast } from '@/state/toasts';

/*
 * Run a whitelisted action from the UI with consistent feedback:
 * busy state, success/error toast (details in an expander), and a clear
 * message when a privileged action is tried without administrative access.
 */
export function useAction() {
  const { t } = useT();
  const toast = useToast();
  const { admin } = useSystem();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async <K extends ActionId>(id: K, params: ActionParams<K>, opts: RunOptions & { success?: string; quiet?: boolean } = {}) => {
      if (actionMeta(id).privileged && !admin) {
        toast({ kind: 'warning', title: t('action.needAdmin') });
        return null;
      }
      setBusy(id);
      try {
        const out = await runAction(id, params, opts);
        if (opts.success) toast({ kind: 'success', title: opts.success });
        return out;
      } catch (e) {
        if (!opts.quiet) {
          const err = e as ActionError;
          const denied = err.problem === 'access-denied';
          toast({
            kind: 'error',
            title: denied ? t('action.needAdmin') : t('action.failed'),
            details: err.details || err.message,
          });
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [admin, t, toast],
  );

  return { run, busy, isAdmin: !!admin };
}
