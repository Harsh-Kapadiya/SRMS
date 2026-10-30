'use client';
/**
 * Feedback shared by all four apps: success/error toasts, a load state that shows the error instead of spinning forever, and the full-page
 * status screen used by not-found.tsx and error.tsx.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, Button, Loading, cx } from './components';

// ─── Toasts ──────────────────────────────────────────────────────────────────

type ToastItem = { id: number; text: string; tone: 'ok' | 'bad' };
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(list: ToastItem[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

/** Show a short message at the top of the screen for 4 seconds. */
export function toast(text: string, tone: 'ok' | 'bad' = 'ok') {
  const id = nextId++;
  items = [...items, { id, text, tone }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

/** Mount once per app (root layout). */
export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.add(setList);
    return () => void listeners.delete(setList);
  }, []);
  return (
    <div role="status" aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            'flex max-w-md items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg',
            t.tone === 'ok' ? 'border-ok/30 bg-ok-soft text-ok' : 'border-bad/30 bg-bad-soft text-bad',
          )}
        >
          {t.tone === 'ok' ? <CircleCheck className="size-5 shrink-0" aria-hidden /> : <CircleAlert className="size-5 shrink-0" aria-hidden />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ─── Loading that can fail ───────────────────────────────────────────────────

/** Spinner while loading; the error and a retry button if the request failed. Spread a `useGet` result into it. */
export function LoadState({ error, reload, label, retry = 'Try again' }: { error?: { message: string }; reload?: () => void; label?: string; retry?: string }) {
  if (!error) return <Loading label={label} />;
  return (
    <div className="p-4">
      <Alert tone="bad" title={error.message} action={reload && <Button size="sm" variant="secondary" onClick={reload}>{retry}</Button>} />
    </div>
  );
}

// ─── Full-page status (404, crash) ───────────────────────────────────────────

export function StatusPage({ code, title, children, actions }: { code: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={56} height={56} className="rounded-xl" />
      <p className="font-mono text-sm font-semibold text-brand">{code}</p>
      <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
      {children && <div className="text-ink-3">{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </main>
  );
}
