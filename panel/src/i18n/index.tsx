import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { useSettings } from '@/state/settings';

/*
 * Tiny i18n: flat JSON files keyed by "area.name". uz.json is the reference;
 * the TranslationKey type comes from it, so a typo in t('...') is a compile error.
 */

export type TranslationKey = keyof typeof uz;
export type Lang = 'uz' | 'ru' | 'en';

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { uz, ru, en };
const locales: Record<Lang, string> = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-GB' };

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  locale: string;
  t: TFn;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const lang = settings.language;

  const t = useCallback<TFn>(
    (key, vars) => {
      let s = dictionaries[lang][key] ?? uz[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, locale: locales[lang], t }), [lang, t]);
  document.documentElement.lang = lang;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT outside I18nProvider');
  return ctx;
}

/** "12 kun 4 soat" — the two most significant units. */
export function formatDuration(t: TFn, seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${t('time.d', { n: d })} ${t('time.h', { n: h })}`;
  if (h > 0) return `${t('time.h', { n: h })} ${t('time.m', { n: m })}`;
  return t('time.m', { n: m });
}

// Many browsers ship without Uzbek locale data, so uz dates are formatted by hand.
const UZ_DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** "Payshanba, 26-noyabr" (capitalised). */
export function formatToday(locale: string, date = new Date()): string {
  if (locale.startsWith('uz')) return `${UZ_DAYS[date.getDay()]}, ${date.getDate()}-${UZ_MONTHS[date.getMonth()]}`;
  const s = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
