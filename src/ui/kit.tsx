import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { initials } from '../lib/format';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ---------- Button ---------- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:brightness-110 border-transparent',
  secondary: 'bg-white text-ink border-line hover:bg-canvas',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-black/5',
  danger: 'bg-white text-bad border-red-200 hover:bg-red-50',
};
const btnBase = 'inline-flex items-center justify-center gap-2 rounded-md border px-3.5 min-h-10 text-sm font-medium whitespace-nowrap transition disabled:opacity-50 disabled:cursor-not-allowed select-none';
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; small?: boolean };
export function Button({ variant = 'secondary', busy, small, className, children, disabled, ...p }: BtnProps) {
  return (
    <button {...p} type={p.type ?? 'button'} disabled={disabled || busy} aria-busy={busy || undefined}
      className={cx(btnBase, variants[variant], small && 'min-h-8 px-2.5 text-[13px]', className)}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}
export function LinkButton({ variant = 'secondary', small, className, ...p }: LinkProps & { variant?: Variant; small?: boolean }) {
  return <Link {...p} className={cx(btnBase, variants[variant], small && 'min-h-8 px-2.5 text-[13px]', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

/* ---------- Form fields ---------- */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const dId = hint || error ? id + '-d' : undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children(id, dId)}
      {error ? <p id={dId} role="alert" className="text-[13px] text-bad">{error}</p> : hint ? <p id={dId} className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}
const inputCls = 'w-full rounded-md border border-line bg-white px-3 min-h-10 text-[15px] placeholder:text-slate-400 focus:border-brand disabled:bg-canvas';
export function TextField({ label, hint, error, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} {...p} className={inputCls} />}</Field>;
}
export function TextArea({ label, hint, error, className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id, d) => <textarea id={id} aria-describedby={d} rows={4} {...p} className={cx(inputCls, 'py-2')} />}</Field>;
}
export function SelectField({ label, hint, error, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: ReactNode; error?: string | null }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id, d) => <select id={id} aria-describedby={d} {...p} className={inputCls}>{children}</select>}</Field>;
}
export function Check({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 accent-[var(--brand)]" />
      <label htmlFor={id} className="text-sm"><span className="font-medium">{label}</span>{hint && <span className="block text-[13px] text-muted">{hint}</span>}</label>
    </div>
  );
}

/* ---------- Badge, Avatar ---------- */
const tones = {
  neutral: 'bg-slate-100 text-slate-700', brand: 'bg-brand-soft text-brand', ok: 'bg-green-50 text-ok', warn: 'bg-amber-50 text-warn', bad: 'bg-red-50 text-bad',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>;
}
export function Avatar({ name, userId, hasPhoto, size = 40 }: { name: string; userId?: string; hasPhoto?: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (hasPhoto && userId && !failed) {
    return <img src={`/api/files/photo/${userId}`} alt="" onError={() => setFailed(true)} style={style} className="shrink-0 rounded-full object-cover bg-slate-200" />;
  }
  return <span aria-hidden style={style} className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">{initials(name)}</span>;
}

/* ---------- States ---------- */
export function Skeleton({ className }: { className?: string }) { return <div aria-hidden className={cx('skeleton', className)} />; }
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return <div role="status" aria-label="Loading" className="space-y-3">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-bad flex items-center justify-between gap-3">
      <span>{error.message}</span>
      {onRetry && <Button small onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const t = { neutral: 'bg-brand-soft border-brand-line text-ink', ok: 'bg-green-50 border-green-200 text-green-900', warn: 'bg-amber-50 border-amber-200 text-amber-900', bad: 'bg-red-50 border-red-200 text-red-900' }[tone];
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('rounded-md border px-3.5 py-2.5 text-sm', t)}>{children}</div>;
}

/* ---------- Dialog (native <dialog>: focus trap + Esc for free) ---------- */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const titleId = useId();
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40', wide ? 'max-w-3xl' : 'max-w-lg')}>
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-black/5">✕</button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

type ConfirmOpts = { title: string; body: ReactNode; confirm: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- Toasts ---------- */
type Toast = { id: number; tone: 'ok' | 'bad' | 'neutral'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; error: (e: unknown) => void }>({ ok: () => {}, error: () => {} });
export const useToast = () => useContext(ToastCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 3500);
  }, []);
  const ctx = {
    ok: useCallback((t: string) => push('ok', t), [push]),
    error: useCallback((e: unknown) => push('bad', e instanceof Error ? e.message : String(e)), [push]),
  };
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const done = (v: boolean) => { confirm?.resolve(v); setConfirm(null); };
  return (
    <ToastCtx.Provider value={ctx}>
      <ConfirmCtx.Provider value={ask}>
        {children}
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} role={t.tone === 'bad' ? 'alert' : 'status'}
              className={cx('pointer-events-auto max-w-md rounded-md px-4 py-2.5 text-sm shadow-lg', t.tone === 'bad' ? 'bg-red-700 text-white' : 'bg-slate-900 text-white')}>{t.text}</div>
          ))}
        </div>
        <Dialog open={!!confirm} onClose={() => done(false)} title={confirm?.title ?? ''}
          footer={<><Button onClick={() => done(false)}>Cancel</Button><Button variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => done(true)}>{confirm?.confirm}</Button></>}>
          <div className="text-sm">{confirm?.body}</div>
        </Dialog>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

/* ---------- Table ---------- */
export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; sort?: (a: T, b: T) => number; className?: string };
export function DataTable<T>({ rows, columns, rowKey, pageSize = 25, empty, searchText, searchPlaceholder = 'Search…' }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; pageSize?: number; empty?: ReactNode; searchText?: (r: T) => string; searchPlaceholder?: string;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  let view = rows;
  if (q && searchText) { const n = q.toLowerCase(); view = view.filter((r) => searchText(r).toLowerCase().includes(n)); }
  const col = columns.find((c) => c.key === sort?.key);
  if (col?.sort) view = [...view].sort((a, b) => col.sort!(a, b) * sort!.dir);
  const pages = Math.max(1, Math.ceil(view.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = view.slice(cur * pageSize, cur * pageSize + pageSize);
  return (
    <div className="space-y-3">
      {searchText && (
        <input type="search" aria-label="Search table" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder={searchPlaceholder}
          className="w-full max-w-xs rounded-md border border-line bg-white px-3 min-h-10 text-sm" />
      )}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className={cx('px-3 py-2.5 font-semibold', c.className)}>
                  {c.sort ? (
                    <button className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                      {c.header}<span aria-hidden>{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {slice.map((r) => <tr key={rowKey(r)} className="hover:bg-canvas/60">{columns.map((c) => <td key={c.key} className={cx('px-3 py-2.5 align-middle', c.className)}>{c.render(r)}</td>)}</tr>)}
            {!slice.length && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted">{empty ?? 'Nothing to show.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{view.length} rows · page {cur + 1} of {pages}</span>
          <div className="flex gap-2"><Button small disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Button><Button small disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</Button></div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{title}</h1>{sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function CopyLink({ label, link }: { label: string; link: string }) {
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white p-2 text-sm">
      <span className="font-medium">{label}</span>
      <input readOnly value={link} aria-label={`${label} link`} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 font-mono text-xs" />
      <Button small onClick={async () => { try { await navigator.clipboard.writeText(link); toast.ok('Link copied'); } catch { toast.error(new Error('Copy failed: select the link and copy it manually')); } }}>Copy</Button>
    </div>
  );
}

export { cx };
