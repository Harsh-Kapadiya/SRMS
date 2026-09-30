'use client';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, OctagonAlert } from 'lucide-react';
import { Badge, cx } from '@srms/ui';

/** Stat tile: label · value · delta vs a named period (colour = direction × whether up is good). */
export function Kpi({ label, value, delta, deltaUnit = 'pp', upIsGood = true, period, hint, status }: {
  label: string;
  value: ReactNode;
  delta?: number;
  deltaUnit?: string;
  upIsGood?: boolean;
  period?: string;
  hint?: ReactNode;
  status?: ReactNode;
}) {
  const good = delta === undefined || delta === 0 ? null : (delta > 0) === upIsGood;
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink-3">{label}</p>
        {status}
      </div>
      <p className="mt-1.5 text-3xl font-bold tracking-tight">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
        {delta !== undefined && (
          <span className={cx('inline-flex items-center gap-0.5 font-semibold', good === null ? 'text-ink-3' : good ? 'text-ok' : 'text-bad')}>
            {delta > 0 ? <ArrowUpRight className="size-4" aria-hidden /> : delta < 0 ? <ArrowDownRight className="size-4" aria-hidden /> : null}
            {delta > 0 ? '+' : ''}
            {delta.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
            {deltaUnit}
            {period && <span className="font-normal text-ink-3">&nbsp;vs {period}</span>}
          </span>
        )}
        {hint && <span className="text-ink-3">{hint}</span>}
      </div>
    </div>
  );
}

/** Status is never colour alone: icon + label + tone. */
export function Status({ level, children }: { level: 'good' | 'warning' | 'critical'; children: ReactNode }) {
  const Icon = level === 'good' ? CircleCheck : level === 'warning' ? CircleAlert : OctagonAlert;
  return (
    <Badge tone={level === 'good' ? 'ok' : level === 'warning' ? 'warn' : 'bad'}>
      <Icon className="size-3.5" aria-hidden />
      {children}
    </Badge>
  );
}

export const coverageStatus = (pct: number) =>
  pct >= 85 ? <Status level="good">On track</Status> : pct >= 70 ? <Status level="warning">Below target</Status> : <Status level="critical">Low</Status>;

export const leakageStatus = (pct: number) =>
  pct === 0 ? <Status level="good">None found</Status> : pct < 2 ? <Status level="warning">Watch</Status> : <Status level="critical">Investigate</Status>;

export const fmtKg = (n: number) => `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`;
export const fmtPct = (n: number) => `${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
