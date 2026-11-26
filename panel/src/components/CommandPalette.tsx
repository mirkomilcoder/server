import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { useT } from '@/i18n';
import { useMotion } from '@/theme/motion';
import { PAGES, type PageId } from '@/pages/registry';

/*
 * Ctrl+K palette. M2: pages. Later milestones add bots, services and
 * whitelisted actions as extra groups (same fuzzy matcher).
 */

/** Subsequence fuzzy score: higher is better, -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const s = text.toLowerCase();
  if (!q) return 0;
  if (s.includes(q)) return 100 - s.indexOf(q);
  let qi = 0, score = 0, streak = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) { qi++; streak++; score += streak; } else streak = 0;
  }
  return qi === q.length ? score : -1;
}

export function CommandPalette({ open, onClose, go }: { open: boolean; onClose: () => void; go: (id: PageId) => void }) {
  const { t } = useT();
  const m = useMotion();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () =>
      PAGES.map((p) => ({ p, score: fuzzyScore(q, `${t(p.label)} ${p.id}`) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score),
    [q, t],
  );

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);

  const choose = (id: PageId) => {
    onClose();
    go(id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); choose(results[sel].p.id); }
    else if (e.key === 'Escape') onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: m.dur(0.15) }}
        >
          <motion.div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label={t('top.search')}
            initial={{ opacity: 0, y: m.reduced ? 0 : -10, scale: m.reduced ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: m.reduced ? 0 : -6 }}
            transition={{ duration: m.dur(0.2), ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="palette__search">
              <Search size={18} aria-hidden />
              <input
                ref={input}
                className="palette__input"
                placeholder={t('palette.placeholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
              />
            </div>
            <ul className="palette__list" id="palette-list" role="listbox">
              {results.length === 0 ? (
                <li className="palette__empty">{t('palette.empty')}</li>
              ) : (
                <>
                  <li className="palette__group" role="presentation">{t('palette.pages')}</li>
                  {results.map(({ p }, i) => (
                    <li
                      key={p.id}
                      role="option"
                      aria-selected={i === sel}
                      className="palette__item"
                      onMouseEnter={() => setSel(i)}
                      onClick={() => choose(p.id)}
                    >
                      <p.icon size={18} aria-hidden />
                      {t(p.label)}
                    </li>
                  ))}
                </>
              )}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
