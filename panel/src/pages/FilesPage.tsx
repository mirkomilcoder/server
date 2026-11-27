import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardPaste, Copy, Download, Eye, EyeOff, File, FileArchive, FileCode2,
  FilePlus2, FileText, Folder, FolderOpen, FolderPlus, HardDrive, Home, Image, Info, LayoutGrid, Link2, List, Loader2,
  MoreHorizontal, Pencil, RefreshCw, Scissors, Search, Server, ShieldAlert, Trash2, Upload, X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  baseName, downloadUrl, humanSize, isDirLike, isImage, isTar, isTextLike, isZip, join, list, normalize, parent,
  readBytes, search, triggerDownload, upload, type Entry,
} from '@/api/files';
import { ActionError, runAction } from '@/api/run';
import { cockpit, sessionUser } from '@/api/cockpit';
import { routeOption } from '@/router';
import { useT } from '@/i18n';
import { useSystem } from '@/state/system';
import { useToast } from '@/state/toasts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FileEditor } from './files/FileEditor';
import { ImagePreview, NameDialog, PropsDialog } from './files/FileDialogs';
import type { PageProps } from './registry';

/*
 * File manager. Directory operations run through the action whitelist (argv,
 * validated paths, never a shell); contents move over Cockpit file channels.
 * Everything runs with the logged-in user's own permissions; "Admin rejimi"
 * (only with Cockpit administrative access) runs the same operations as root
 * and writes each one to the activity log.
 */

type SortKey = 'name' | 'size' | 'mtime';
interface Item { path: string; e: Entry }
interface UploadJob { id: number; name: string; size: number; sent: number; state: 'up' | 'done' | 'error'; error?: string; ctl: AbortController }
type Dialog =
  | { kind: 'mkdir' | 'touch' }
  | { kind: 'rename' | 'duplicate'; item: Item }
  | { kind: 'compress'; items: Item[] }
  | { kind: 'delete' | 'props'; items: Item[] }
  | { kind: 'extract'; item: Item }
  | { kind: 'overwrite'; files: File[]; clash: string[] }
  | null;

const PREF_KEY = 'mk-files-prefs';
function loadPrefs(): { hidden: boolean; view: 'list' | 'grid' } {
  try {
    return { hidden: false, view: 'list', ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return { hidden: false, view: 'list' };
  }
}

function iconFor(e: Entry) {
  if (isDirLike(e)) return Folder;
  if (e.type === 'link') return Link2;
  if (isImage(e.name)) return Image;
  if (isTar(e.name) || isZip(e.name)) return FileArchive;
  if (/\.(py|js|ts|tsx|jsx|sh|go|rs|php|rb|java|c|cpp|h|json|ya?ml|toml|html|css|sql)$/i.test(e.name)) return FileCode2;
  if (isTextLike(e.name)) return FileText;
  return File;
}

const errText = (e: unknown) => (e instanceof ActionError ? (e.details || e.message) : (e as Error)?.message ?? String(e));

export default function FilesPage(_props: PageProps) {
  const { t, locale, lang } = useT();
  const toast = useToast();
  const sys = useSystem();
  const home = useMemo(() => sessionUser().home || '/', []);
  const canAdmin = sys.admin === true;

  const [cwd, setCwd] = useState(() => {
    const fromUrl = routeOption('path');
    return (fromUrl && normalize(fromUrl, home, '/')) || home;
  });
  const [hist, setHist] = useState<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asAdmin, setAsAdmin] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const [filter, setFilter] = useState('');
  const [found, setFound] = useState<{ q: string; items: Entry[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [clip, setClip] = useState<{ mode: 'copy' | 'cut'; paths: string[] } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [editPath, setEditPath] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const jobId = useRef(0);

  const admin = asAdmin && canAdmin;
  useEffect(() => {
    if (!canAdmin) setAsAdmin(false);
  }, [canAdmin]);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch { /* private mode */ }
  }, [prefs]);

  // ---------------------------------------------------------------- loading

  const load = useCallback(async (path = cwd) => {
    setLoading(true);
    try {
      const items = await list(path, admin);
      setEntries(items);
      setError(null);
    } catch (e) {
      setEntries(null);
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [cwd, admin]);

  useEffect(() => {
    setSelected(new Set());
    setFound(null);
    setFilter('');
    void load(cwd);
    cockpit().location.replace(['files'], cwd === home ? undefined : { path: cwd });
  }, [cwd, admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = (path: string) => {
    if (path === cwd) return void load();
    setHist((h) => ({ back: [...h.back.slice(-49), cwd], fwd: [] }));
    setCwd(path);
  };
  const back = () => {
    const prev = hist.back.at(-1);
    if (!prev) return;
    setHist((h) => ({ back: h.back.slice(0, -1), fwd: [cwd, ...h.fwd] }));
    setCwd(prev);
  };
  const forward = () => {
    const next = hist.fwd[0];
    if (!next) return;
    setHist((h) => ({ back: [...h.back, cwd], fwd: h.fwd.slice(1) }));
    setCwd(next);
  };

  // ---------------------------------------------------------------- derived list

  const items: Item[] = useMemo(() => {
    const src = found ? found.items : entries ?? [];
    let out = src
      .filter((e) => prefs.hidden || found || !e.name.startsWith('.'))
      .filter((e) => !filter || found || e.name.toLowerCase().includes(filter.toLowerCase()))
      .map((e) => ({ path: join(cwd, e.rel ?? e.name), e }));
    const dir = sort.desc ? -1 : 1;
    out = out.sort((a, b) => {
      const da = isDirLike(a.e) ? 0 : 1;
      const db = isDirLike(b.e) ? 0 : 1;
      if (da !== db) return da - db;
      const v = sort.key === 'size' ? a.e.size - b.e.size : sort.key === 'mtime' ? a.e.mtime - b.e.mtime
        : a.e.name.localeCompare(b.e.name, undefined, { numeric: true, sensitivity: 'base' });
      return v * dir;
    });
    return out;
  }, [entries, found, prefs.hidden, filter, sort, cwd]);

  const names = useMemo(() => new Set((entries ?? []).map((e) => e.name)), [entries]);
  const sel = items.filter((i) => selected.has(i.path));
  const hiddenCount = (entries ?? []).filter((e) => e.name.startsWith('.')).length;

  // ---------------------------------------------------------------- operations

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast({ kind: 'success', title: okMsg });
      return true;
    } catch (e) {
      const msg = errText(e);
      const denied = /permission denied|ruxsat/i.test(msg);
      toast({
        kind: 'error',
        title: denied && canAdmin && !admin ? t('fm.deniedTryAdmin') : t('action.failed'),
        details: msg,
      });
      return false;
    } finally {
      setBusy(false);
      void load();
    }
  };

  const download = async (path: string) => {
    const url = downloadUrl(path, admin);
    if (url) return triggerDownload(url);
    // dev mock / no transport: small files through memory
    try {
      const bytes = await readBytes(path, admin);
      const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = baseName(path);
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (e) {
      toast({ kind: 'error', title: t('action.failed'), details: errText(e) });
    }
  };

  const open = (it: Item) => {
    const { e, path } = it;
    if (isDirLike(e)) {
      if (found) setFound(null);
      return navigate(path);
    }
    if (isImage(e.name)) return setPreviewPath(path);
    if (isTar(e.name) || isZip(e.name)) return setDialog({ kind: 'extract', item: it });
    if (isTextLike(e.name) || e.size < 512 * 1024) return setEditPath(path);
    void download(path);
  };

  const paste = async () => {
    if (!clip) return;
    const fn = clip.mode === 'copy' ? 'files.copy' : 'files.move';
    const ok = await run(() => runAction(fn, { paths: clip.paths, dir: cwd }, { asAdmin: admin }),
      clip.mode === 'copy' ? t('fm.copied', { n: clip.paths.length }) : t('fm.moved', { n: clip.paths.length }));
    if (ok && clip.mode === 'cut') setClip(null);
  };

  const startUploads = (files: File[], overwrite: boolean) => {
    for (const file of files) {
      const job: UploadJob = { id: ++jobId.current, name: file.name, size: file.size, sent: 0, state: 'up', ctl: new AbortController() };
      setUploads((u) => [...u, job]);
      const set = (patch: Partial<UploadJob>) => setUploads((u) => u.map((j) => (j.id === job.id ? { ...j, ...patch } : j)));
      const dir = cwd;
      upload(file, join(dir, file.name), admin, overwrite, (sent) => set({ sent }), job.ctl.signal).then(
        () => {
          set({ state: 'done', sent: file.size });
          void load();
          setTimeout(() => setUploads((u) => u.filter((j) => j.id !== job.id)), 4000);
        },
        (e) => set({ state: 'error', error: (e as { problem?: string })?.problem === 'change-conflict' ? t('fm.exists') : errText(e) }),
      );
    }
  };

  const queueUploads = (files: File[]) => {
    const bad = files.filter((f) => !/^(?!\.{1,2}$)[^/\u0000-\u001f\u007f]{1,255}$/.test(f.name));
    if (bad.length) toast({ kind: 'warning', title: t('fm.badName'), details: bad.map((f) => f.name).join(', ') });
    const ok = files.filter((f) => !bad.includes(f));
    const clash = ok.filter((f) => names.has(f.name)).map((f) => f.name);
    if (clash.length) setDialog({ kind: 'overwrite', files: ok, clash });
    else if (ok.length) startUploads(ok, false);
  };

  // ---------------------------------------------------------------- selection & keyboard

  const clickItem = (it: Item, ev: React.MouseEvent) => {
    setMenu(null);
    if (ev.shiftKey && anchor) {
      const a = items.findIndex((i) => i.path === anchor);
      const b = items.findIndex((i) => i.path === it.path);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(items.slice(lo, hi + 1).map((i) => i.path)));
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      const next = new Set(selected);
      if (next.has(it.path)) next.delete(it.path);
      else next.add(it.path);
      setSelected(next);
    } else {
      setSelected(new Set([it.path]));
    }
    setAnchor(it.path);
  };

  const toggleCheck = (it: Item) => {
    const next = new Set(selected);
    if (next.has(it.path)) next.delete(it.path);
    else next.add(it.path);
    setSelected(next);
    setAnchor(it.path);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    if ((ev.target as HTMLElement).closest('input, textarea, select')) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const idx = items.findIndex((i) => i.path === anchor);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const n = Math.max(0, Math.min(items.length - 1, idx + (ev.key === 'ArrowDown' ? 1 : -1)));
      const it = items[n];
      if (!it) return;
      setSelected(new Set([it.path]));
      setAnchor(it.path);
      listRef.current?.querySelector(`[data-path="${CSS.escape(it.path)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter' && sel.length === 1) {
      open(sel[0]);
    } else if (ev.key === 'Backspace' && !found) {
      ev.preventDefault();
      navigate(parent(cwd));
    } else if (ev.key === 'Delete' && sel.length) {
      setDialog({ kind: 'delete', items: sel });
    } else if (ev.key === 'F2' && sel.length === 1) {
      setDialog({ kind: 'rename', item: sel[0] });
    } else if (mod && ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      setSelected(new Set(items.map((i) => i.path)));
    } else if (mod && ev.key.toLowerCase() === 'c' && sel.length) {
      setClip({ mode: 'copy', paths: sel.map((i) => i.path) });
    } else if (mod && ev.key.toLowerCase() === 'x' && sel.length) {
      setClip({ mode: 'cut', paths: sel.map((i) => i.path) });
    } else if (mod && ev.key.toLowerCase() === 'v' && clip) {
      void paste();
    } else if (ev.key === 'Escape') {
      setSelected(new Set());
      setMenu(null);
    }
  };

  // ---------------------------------------------------------------- render helpers

  const places = [
    { path: home, label: t('fm.home'), icon: Home },
    { path: '/srv', label: '/srv', icon: Server },
    { path: '/opt', label: '/opt', icon: FolderOpen },
    { path: '/var/log', label: t('fm.logs'), icon: FileText },
    { path: '/etc', label: '/etc', icon: Folder },
    { path: '/', label: t('fm.root'), icon: HardDrive },
  ];

  const crumbs = cwd === '/' ? [] : cwd.slice(1).split('/');
  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }));
  const SortIcon = ({ k }: { k: SortKey }) => (sort.key === k ? (sort.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />) : null);
  const menuItem = menu ? items.find((i) => i.path === menu.path) : undefined;
  const menuTargets = menuItem && selected.has(menuItem.path) ? sel : menuItem ? [menuItem] : [];

  const itemActions = (targets: Item[]) => {
    const one = targets.length === 1 ? targets[0] : null;
    return [
      one && { label: isDirLike(one.e) ? t('fm.open') : t('fm.openFile'), icon: FolderOpen, run: () => open(one) },
      one && !isDirLike(one.e) && { label: t('fm.download'), icon: Download, run: () => download(one.path) },
      one && { label: t('fm.rename'), icon: Pencil, run: () => setDialog({ kind: 'rename', item: one }) },
      one && { label: t('fm.duplicate'), icon: Copy, run: () => setDialog({ kind: 'duplicate', item: one }) },
      { label: t('fm.copy'), icon: Copy, run: () => setClip({ mode: 'copy', paths: targets.map((i) => i.path) }) },
      { label: t('fm.cut'), icon: Scissors, run: () => setClip({ mode: 'cut', paths: targets.map((i) => i.path) }) },
      !found && { label: t('fm.compress'), icon: FileArchive, run: () => setDialog({ kind: 'compress', items: targets }) },
      one && (isTar(one.e.name) || isZip(one.e.name)) && { label: t('fm.extract'), icon: FileArchive, run: () => setDialog({ kind: 'extract', item: one }) },
      { label: t('fm.props'), icon: Info, run: () => setDialog({ kind: 'props', items: targets }) },
      { label: t('fm.delete'), icon: Trash2, danger: true, run: () => setDialog({ kind: 'delete', items: targets }) },
    ].filter(Boolean) as { label: string; icon: typeof File; danger?: boolean; run: () => void }[];
  };

  const close = () => setDialog(null);
  const d = dialog;

  return (
    <div className="fm" onKeyDown={onKey}>
      <div className="page-head">
        <div>
          <h1>{t('nav.files')}</h1>
          <p className="muted">{t('fm.intro')}</p>
        </div>
        <div className="row-gap">
          {canAdmin && (
            <button className={`btn${admin ? ' btn--danger' : ''}`} aria-pressed={admin} onClick={() => setAsAdmin(!asAdmin)}
              title={t('fm.adminHint')}>
              <ShieldAlert size={16} /> {admin ? t('fm.adminOn') : t('fm.adminOff')}
            </button>
          )}
          <button className="btn" onClick={() => setDialog({ kind: 'mkdir' })} disabled={!!found}><FolderPlus size={16} /> {t('fm.newFolder')}</button>
          <button className="btn" onClick={() => setDialog({ kind: 'touch' })} disabled={!!found}><FilePlus2 size={16} /> {t('fm.newFile')}</button>
          <button className="btn btn--accent" onClick={() => fileInput.current?.click()} disabled={!!found}><Upload size={16} /> {t('fm.upload')}</button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => {
            queueUploads([...(e.target.files ?? [])]);
            e.target.value = '';
          }} />
        </div>
      </div>

      {admin && <div className="notice notice--danger fm-admin-note" role="status"><ShieldAlert size={16} /> {t('fm.adminNote')}</div>}

      <div className="fm-layout">
        <nav className="fm-places card" aria-label={t('fm.places')}>
          {places.map((p) => (
            <button key={p.path} className={`fm-place${cwd === p.path ? ' fm-place--active' : ''}`} onClick={() => navigate(p.path)}>
              <p.icon size={17} aria-hidden /> <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <section className="fm-main card"
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') && !found) { e.preventDefault(); setDragOver(true); } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length || found) return;
            e.preventDefault();
            setDragOver(false);
            queueUploads([...e.dataTransfer.files]);
          }}>
          <div className="fm-toolbar">
            <div className="fm-nav">
              <button className="icon-btn" onClick={back} disabled={!hist.back.length} aria-label={t('common.back')}><ArrowLeft size={17} /></button>
              <button className="icon-btn" onClick={forward} disabled={!hist.fwd.length} aria-label={t('fm.forward')}><ArrowRight size={17} /></button>
              <button className="icon-btn" onClick={() => navigate(parent(cwd))} disabled={cwd === '/'} aria-label={t('fm.up')}><ArrowUp size={17} /></button>
            </div>
            {editingPath !== null ? (
              <form className="fm-path-edit" onSubmit={(e) => {
                e.preventDefault();
                const p = normalize(editingPath, home, cwd);
                if (!p) return toast({ kind: 'error', title: t('fm.badPath') });
                setEditingPath(null);
                navigate(p);
              }}>
                <input className="input input--plain mono" autoFocus value={editingPath} spellCheck={false}
                  onChange={(e) => setEditingPath(e.target.value)} onBlur={() => setEditingPath(null)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditingPath(null)} aria-label={t('fm.path')} />
              </form>
            ) : (
              <div className="fm-crumbs" onDoubleClick={() => setEditingPath(cwd)} title={t('fm.editPath')}>
                <button className="fm-crumb" onClick={() => navigate('/')}><HardDrive size={15} aria-label="/" /></button>
                {crumbs.map((c, i) => {
                  const p = '/' + crumbs.slice(0, i + 1).join('/');
                  return (
                    <span key={p} className="fm-crumb-wrap">
                      <span className="fm-crumb-sep">/</span>
                      <button className={`fm-crumb${i === crumbs.length - 1 ? ' fm-crumb--last' : ''}`} onClick={() => navigate(p)}>{c}</button>
                    </span>
                  );
                })}
                <button className="fm-crumb fm-crumb--edit" onClick={() => setEditingPath(cwd)} aria-label={t('fm.editPath')}><Pencil size={13} /></button>
              </div>
            )}
            <form className="fm-search" onSubmit={async (e) => {
              e.preventDefault();
              const q = filter.trim();
              if (!q) return;
              setSearching(true);
              try {
                setFound({ q, items: (await search(cwd, q, admin)).slice(0, 1000) });
              } catch (err) {
                toast({ kind: 'error', title: t('action.failed'), details: errText(err) });
              } finally {
                setSearching(false);
              }
            }}>
              <Search size={16} aria-hidden />
              <input className="input input--plain" value={filter} placeholder={t('fm.searchPh')} aria-label={t('fm.searchPh')}
                onChange={(e) => { setFilter(e.target.value); if (found) setFound(null); }} />
              {searching && <Loader2 size={16} className="spin" aria-hidden />}
            </form>
            <div className="fm-nav">
              <button className={`icon-btn${prefs.hidden ? ' icon-btn--on' : ''}`} aria-pressed={prefs.hidden}
                onClick={() => setPrefs({ ...prefs, hidden: !prefs.hidden })} title={t('fm.hidden', { n: hiddenCount })}>
                {prefs.hidden ? <Eye size={17} /> : <EyeOff size={17} />}
              </button>
              <button className="icon-btn" onClick={() => setPrefs({ ...prefs, view: prefs.view === 'list' ? 'grid' : 'list' })}
                aria-label={t('fm.view')}>{prefs.view === 'list' ? <LayoutGrid size={17} /> : <List size={17} />}</button>
              <button className="icon-btn" onClick={() => load()} aria-label={t('fm.refresh')}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
            </div>
          </div>

          {(sel.length > 0 || clip) && (
            <div className="fm-selbar">
              {sel.length > 0 && <span className="fm-selbar__count">{t('fm.selected', { n: sel.length })}</span>}
              {sel.length > 0 && itemActions(sel).filter((a) => a.label !== t('fm.open') && a.label !== t('fm.openFile')).map((a) => (
                <button key={a.label} className={`btn btn--sm${a.danger ? ' btn--danger-ghost' : ' btn--ghost'}`} onClick={a.run} disabled={busy}>
                  <a.icon size={14} /> <span className="fm-selbar__label">{a.label}</span>
                </button>
              ))}
              {clip && !found && (
                <button className="btn btn--sm btn--accent" onClick={paste} disabled={busy}>
                  <ClipboardPaste size={14} /> {t('fm.paste', { n: clip.paths.length })}
                </button>
              )}
              {clip && <button className="icon-btn" onClick={() => setClip(null)} aria-label={t('fm.clearClip')}><X size={15} /></button>}
              {sel.length > 0 && <button className="btn btn--sm btn--ghost fm-selbar__clear" onClick={() => setSelected(new Set())}>{t('fm.clear')}</button>}
            </div>
          )}

          {found && (
            <div className="fm-found">
              <Search size={15} /> {t('fm.found', { n: found.items.length, q: found.q })}
              <button className="btn btn--sm btn--ghost" onClick={() => { setFound(null); setFilter(''); }}><X size={14} /> {t('fm.clear')}</button>
            </div>
          )}

          <div ref={listRef} className={`fm-list fm-list--${prefs.view}${dragOver ? ' fm-list--drop' : ''}`} tabIndex={0}
            role="grid" aria-label={cwd} aria-multiselectable="true"
            onClick={(e) => { if (e.target === e.currentTarget) setSelected(new Set()); }}>
            {prefs.view === 'list' && items.length > 0 && (
              <div className="fm-row fm-row--head" role="row">
                <span className="fm-check" />
                <button className="fm-col fm-col--name" onClick={() => sortBy('name')}>{t('fm.name')} <SortIcon k="name" /></button>
                <button className="fm-col fm-col--size" onClick={() => sortBy('size')}>{t('fm.size')} <SortIcon k="size" /></button>
                <button className="fm-col fm-col--date" onClick={() => sortBy('mtime')}>{t('fm.modified')} <SortIcon k="mtime" /></button>
                <span className="fm-col fm-col--perm">{t('fm.perms')}</span>
                <span className="fm-col fm-col--menu" />
              </div>
            )}

            {error ? (
              <div className="empty">
                <div className="empty__icon"><ShieldAlert size={26} /></div>
                <h2>{t('fm.cantOpen')}</h2>
                <p className="mono">{error}</p>
                <div className="row-gap">
                  <button className="btn" onClick={() => navigate(parent(cwd))}><ArrowUp size={15} /> {t('fm.up')}</button>
                  {canAdmin && !admin && <button className="btn btn--accent" onClick={() => setAsAdmin(true)}><ShieldAlert size={15} /> {t('fm.adminOff')}</button>}
                </div>
              </div>
            ) : entries === null ? (
              <div className="fm-loading">{Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton fm-skel" />)}</div>
            ) : items.length === 0 ? (
              <div className="empty">
                <div className="empty__icon"><FolderOpen size={26} /></div>
                <h2>{found ? t('fm.noResults') : filter ? t('fm.noMatch') : t('fm.empty')}</h2>
                {!found && !filter && <p>{t('fm.emptyHint')}</p>}
              </div>
            ) : (
              items.map((it) => {
                const Icon = iconFor(it.e);
                const isSel = selected.has(it.path);
                const cut = clip?.mode === 'cut' && clip.paths.includes(it.path);
                return (
                  <div key={it.path} data-path={it.path} role="row" aria-selected={isSel}
                    className={`fm-row${isSel ? ' fm-row--sel' : ''}${cut ? ' fm-row--cut' : ''}${it.e.name.startsWith('.') ? ' fm-row--hidden' : ''}`}
                    onClick={(e) => clickItem(it, e)}
                    onDoubleClick={() => open(it)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!selected.has(it.path)) setSelected(new Set([it.path]));
                      setMenu({ path: it.path, x: e.clientX, y: e.clientY });
                    }}>
                    <span className="fm-check">
                      <input type="checkbox" checked={isSel} aria-label={it.e.name}
                        onClick={(e) => e.stopPropagation()} onChange={() => toggleCheck(it)} />
                    </span>
                    <span className="fm-col fm-col--name">
                      <span className={`fm-icon${isDirLike(it.e) ? ' fm-icon--dir' : ''}`}><Icon size={prefs.view === 'grid' ? 30 : 18} aria-hidden /></span>
                      <span className="fm-name">
                        <button className="fm-name__btn" onClick={(e) => { e.stopPropagation(); open(it); }} title={it.e.rel ?? it.e.name}>{it.e.rel ?? it.e.name}</button>
                        {it.e.linkTo && <span className="fm-link mono">→ {it.e.linkTo}</span>}
                      </span>
                    </span>
                    <span className="fm-col fm-col--size">{isDirLike(it.e) ? '—' : humanSize(it.e.size)}</span>
                    <span className="fm-col fm-col--date" title={new Date(it.e.mtime * 1000).toLocaleString(locale)}>{fmtDate(it.e.mtime, lang)}</span>
                    <span className="fm-col fm-col--perm mono" title={`${it.e.owner}:${it.e.group}`}>{it.e.mode} · {it.e.owner}</span>
                    <span className="fm-col fm-col--menu">
                      <button className="icon-btn" aria-label={t('fm.actions')} onClick={(e) => {
                        e.stopPropagation();
                        if (!selected.has(it.path)) setSelected(new Set([it.path]));
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu({ path: it.path, x: r.right, y: r.bottom });
                      }}><MoreHorizontal size={17} /></button>
                    </span>
                  </div>
                );
              })
            )}
            {dragOver && <div className="fm-drop"><Upload size={28} /> {t('fm.dropHere', { dir: cwd })}</div>}
          </div>
          <div className="fm-status card__meta">
            {entries && t('fm.count', { n: items.length })}
            {hiddenCount > 0 && !prefs.hidden && !found && ` · ${t('fm.hiddenCount', { n: hiddenCount })}`}
          </div>
        </section>
      </div>

      {/* row context menu */}
      <AnimatePresence>
        {menu && menuTargets.length > 0 && (
          <>
            <div className="fm-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
            <motion.div className="fm-menu" role="menu"
              style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 380) }}
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              {itemActions(menuTargets).map((a) => (
                <button key={a.label} role="menuitem" className={`fm-menu__item${a.danger ? ' fm-menu__item--danger' : ''}`}
                  onClick={() => { setMenu(null); a.run(); }}>
                  <a.icon size={15} aria-hidden /> {a.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* uploads */}
      {uploads.length > 0 && (
        <div className="fm-uploads card" role="status">
          <div className="fm-uploads__head">
            <Upload size={16} /> {t('fm.uploads')}
            <button className="icon-btn" aria-label={t('common.close')}
              onClick={() => setUploads((u) => u.filter((j) => j.state === 'up'))}><X size={15} /></button>
          </div>
          {uploads.map((j) => (
            <div className="fm-upload" key={j.id}>
              <div className="fm-upload__row">
                <span className="fm-upload__name" title={j.name}>{j.name}</span>
                <span className={`card__meta${j.state === 'error' ? ' c-danger' : j.state === 'done' ? ' c-success' : ''}`}>
                  {j.state === 'error' ? t('fm.failed') : j.state === 'done' ? '✓' : `${humanSize(j.sent)} / ${humanSize(j.size)}`}
                </span>
                {j.state === 'up' && <button className="icon-btn" aria-label={t('common.cancel')} onClick={() => j.ctl.abort()}><X size={14} /></button>}
              </div>
              <div className="fm-upload__bar"><span style={{ width: `${j.size ? (j.sent / j.size) * 100 : 100}%` }} className={j.state === 'error' ? 'is-error' : ''} /></div>
              {j.error && <div className="form-error fm-upload__err">{j.error}</div>}
            </div>
          ))}
        </div>
      )}

      {/* dialogs */}
      <NameDialog open={d?.kind === 'mkdir'} title={t('fm.newFolder')} initial="" taken={names} confirmLabel={t('fm.create')} onClose={close}
        onSubmit={(n) => { close(); void run(() => runAction('files.mkdir', { path: join(cwd, n) }, { asAdmin: admin }), t('fm.created', { name: n })); }} />
      <NameDialog open={d?.kind === 'touch'} title={t('fm.newFile')} initial="" taken={names} confirmLabel={t('fm.create')} onClose={close}
        onSubmit={async (n) => {
          close();
          if (await run(() => runAction('files.touch', { path: join(cwd, n) }, { asAdmin: admin }), t('fm.created', { name: n }))) setEditPath(join(cwd, n));
        }} />
      <NameDialog open={d?.kind === 'rename'} title={t('fm.rename')} initial={d?.kind === 'rename' ? d.item.e.name : ''} taken={names}
        confirmLabel={t('fm.rename')} onClose={close}
        onSubmit={(n) => {
          if (d?.kind !== 'rename') return;
          const from = d.item.path;
          close();
          void run(() => runAction('files.rename', { from, to: join(parent(from), n) }, { asAdmin: admin }), t('fm.renamed'));
        }} />
      <NameDialog open={d?.kind === 'duplicate'} title={t('fm.duplicate')} taken={names} confirmLabel={t('fm.duplicate')} onClose={close}
        initial={d?.kind === 'duplicate' ? copyName(d.item.e.name, names) : ''}
        onSubmit={(n) => {
          if (d?.kind !== 'duplicate') return;
          const from = d.item.path;
          close();
          void run(() => runAction('files.duplicate', { from, to: join(parent(from), n) }, { asAdmin: admin }), t('fm.copied', { n: 1 }));
        }} />
      <NameDialog open={d?.kind === 'compress'} title={t('fm.compress')} taken={names} confirmLabel={t('fm.compress')} onClose={close}
        initial={d?.kind === 'compress' ? `${d.items.length === 1 ? d.items[0].e.name : baseName(cwd) || 'arxiv'}.tar.gz` : ''}
        onSubmit={(n) => {
          if (d?.kind !== 'compress') return;
          const namesIn = d.items.map((i) => i.e.name);
          close();
          void run(() => runAction('files.compress', { dir: cwd, names: namesIn, out: join(cwd, n) }, { asAdmin: admin }), t('fm.created', { name: n }));
        }} />

      <ConfirmDialog
        open={d?.kind === 'delete'}
        title={t('fm.delete')}
        body={d?.kind === 'delete' ? (
          <>
            <p>{t('fm.deleteBody', { n: d.items.length })}</p>
            <ul className="fm-dellist mono">
              {d.items.slice(0, 8).map((i) => <li key={i.path}>{i.path}{isDirLike(i.e) ? '/' : ''}</li>)}
              {d.items.length > 8 && <li>… +{d.items.length - 8}</li>}
            </ul>
            {admin && <p className="c-danger">{t('fm.deleteAdmin')}</p>}
          </>
        ) : ''}
        confirmLabel={t('fm.delete')}
        expected={d?.kind === 'delete' && (admin || d.items.some((i) => isDirLike(i.e))) && d.items.length === 1 ? d.items[0].e.name : undefined}
        busy={busy}
        onClose={close}
        onConfirm={() => {
          if (d?.kind !== 'delete') return;
          const paths = d.items.map((i) => i.path);
          close();
          setSelected(new Set());
          void run(() => runAction('files.delete', { paths }, { asAdmin: admin }), t('fm.deleted', { n: paths.length }));
        }}
      />

      <ConfirmDialog
        open={d?.kind === 'extract'}
        tone="warning"
        title={t('fm.extract')}
        body={d?.kind === 'extract' ? t('fm.extractBody', { name: d.item.e.name, dir: parent(d.item.path) }) : ''}
        confirmLabel={t('fm.extract')}
        busy={busy}
        onClose={close}
        onConfirm={() => {
          if (d?.kind !== 'extract') return;
          const { path, e } = d.item;
          close();
          const action = isZip(e.name) ? 'files.unzip' : 'files.untar';
          void run(() => runAction(action, { archive: path, dir: parent(path) }, { asAdmin: admin }), t('fm.extracted'));
        }}
      />

      <ConfirmDialog
        open={d?.kind === 'overwrite'}
        tone="warning"
        title={t('fm.overwriteTitle')}
        body={d?.kind === 'overwrite' ? <><p>{t('fm.overwriteBody')}</p><ul className="fm-dellist mono">{d.clash.slice(0, 8).map((n) => <li key={n}>{n}</li>)}</ul></> : ''}
        confirmLabel={t('fm.overwrite')}
        onClose={() => {
          if (d?.kind === 'overwrite') startUploads(d.files.filter((f) => !d.clash.includes(f.name)), false);
          close();
        }}
        onConfirm={() => {
          if (d?.kind === 'overwrite') startUploads(d.files, true);
          close();
        }}
      />

      <PropsDialog items={d?.kind === 'props' ? d.items : null} dir={cwd} asAdmin={admin} onClose={close}
        onChmod={(paths, mode) => { close(); void run(() => runAction('files.chmod', { paths, mode }, { asAdmin: admin }), t('fm.permsSaved')); }} />

      <FileEditor path={editPath} asAdmin={admin} onClose={() => setEditPath(null)} onSaved={() => load()} onDownload={download} />
      <ImagePreview path={previewPath} asAdmin={admin} onClose={() => setPreviewPath(null)} />
    </div>
  );
}

// Own month names: not every browser ships Uzbek date formats (some show "M11 26").
const MONTHS: Record<string, string[]> = {
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function fmtDate(sec: number, lang: string): string {
  const d = new Date(sec * 1000);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const m = (MONTHS[lang] ?? MONTHS.en)[d.getMonth()];
  const day = lang === 'uz' ? `${d.getDate()}-${m}` : `${d.getDate()} ${m}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** "report.pdf" → "report (nusxa).pdf", unique within the folder. */
function copyName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const [stem, tail] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 1; i < 100; i++) {
    const n = `${stem} (${i === 1 ? 'nusxa' : `nusxa ${i}`})${tail}`;
    if (!taken.has(n)) return n;
  }
  return `${stem}-${Date.now()}${tail}`;
}

