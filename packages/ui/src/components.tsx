'use client';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg' | 'sm';
  loading?: boolean;
  block?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'lg' && 'min-h-14 px-6 text-lg',
        size === 'md' && 'min-h-11 px-4 text-base',
        size === 'sm' && 'min-h-9 px-3 text-sm',
        variant === 'primary' && 'bg-brand text-on-brand hover:bg-brand-strong',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-surface-3',
        variant === 'ghost' && 'text-brand hover:bg-brand-soft',
        variant === 'danger' && 'bg-bad text-white hover:opacity-90',
        block && 'w-full',
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────

// Full width by default via .srms-control (components layer), so a `w-*` utility at the call site wins.
const control =
  'srms-control rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60 aria-[invalid=true]:border-bad';

/** Label + control + hint/error, wired for screen readers. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink-2">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={cx(control, className)} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(control, 'appearance-none bg-[length:1.1rem] bg-[right_0.8rem_center] bg-no-repeat pr-10', className)} style={{ backgroundImage: CHEVRON }}>
      {children}
    </select>
  );
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7c72' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(control, 'min-h-28', className)} />;
}

/** 6-digit OTP box: numeric keypad on phones, SMS autofill via autocomplete="one-time-code". */
export const OtpInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function OtpInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      {...rest}
      className={cx(control, 'text-center font-mono text-2xl tracking-[0.5em]', className)}
    />
  );
});

// ─── Display ─────────────────────────────────────────────────────────────────

/** `flush` drops the padding (for edge-to-edge tables); min-w-0 lets a card shrink inside grids so wide tables scroll instead of widening the page. */
export function Card({ className, children, flush, as: Tag = 'section' }: { className?: string; children: ReactNode; flush?: boolean; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cx('min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[0_1px_2px_rgba(16,32,23,0.04)]', flush ? 'overflow-hidden' : 'p-5', className)}>{children}</Tag>;
}

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'info' | 'accent';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  brand: 'bg-brand-soft text-brand-strong',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>{children}</span>;
}

export function Alert({ tone = 'info', title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex flex-wrap items-start gap-3 rounded-xl px-4 py-3', TONES[tone], className)}>
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-sm opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className ?? 'size-6')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-3" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-ink-3">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-3">{children}</div>}
    </div>
  );
}

/** Horizontal meter, e.g. quota used. */
export function Meter({ value, max, tone = 'brand', label }: { value: number; max: number; tone?: 'brand' | 'warn' | 'bad'; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className={cx('h-full rounded-full transition-[width] duration-500', tone === 'brand' && 'bg-brand', tone === 'warn' && 'bg-accent', tone === 'bad' && 'bg-bad')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, action, back }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start gap-3">
      {back}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
