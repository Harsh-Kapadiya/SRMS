'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { Alert, Card, Loading, PageHeader, cx, fmtAgo } from '@srms/ui';
import { api } from '@/lib/client';
import { describe } from '@/lib/audit';
import type { AuditRow, Overview, Paged } from '@/lib/types';

/** A count with a link to the page where it is acted on; `alert` marks a number that needs attention. */
function Tile({ label, value, href, hint, alert }: { label: string; value: number; href?: string; hint?: ReactNode; alert?: boolean }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-ink-3">
        {label}
        {href && <ChevronRight className="size-4 shrink-0" aria-hidden />}
      </span>
      <span className="mt-1 block text-3xl font-bold tabular-nums">{value.toLocaleString('en-IN')}</span>
      {hint && (
        <span className={cx('mt-1 flex items-center gap-1 text-sm', alert ? 'font-semibold text-bad' : 'text-ink-3')}>
          {alert && <AlertTriangle className="size-4" aria-hidden />}
          {hint}
        </span>
      )}
    </>
  );
  const cls = 'block rounded-[var(--radius-card)] border border-line bg-surface p-5';
  return href ? <Link href={href} className={cx(cls, 'hover:border-brand')}>{body}</Link> : <div className={cls}>{body}</div>;
}

export default function OverviewPage() {
  const o = api.useGet<Overview>('/admin/overview');
  const recent = api.useGet<Paged<AuditRow>>('/admin/audit-logs?pageSize=8');

  if (!o.data) return o.error ? <Alert tone="bad" title={o.error.message} /> : <Loading />;
  const d = o.data;
  const healthy = d.smsFailed === 0 && d.failedLogins24h < 5 && d.shopsUnassigned === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Accounts, shops and system health" />

      <section aria-label="Accounts and shops" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="Active dealers" value={d.dealers} href="/dealers" />
        <Tile label="Active shops" value={d.shops} href="/shops" hint={d.shopsUnassigned > 0 ? `${d.shopsUnassigned} without an active dealer` : 'Every active shop has a dealer'} alert={d.shopsUnassigned > 0} />
        <Tile label="Officials" value={d.officials} href="/officials" />
        <Tile label="Verified beneficiaries" value={d.beneficiaries} href="/users?role=BENEFICIARY" hint={`${d.pending} waiting for Aadhaar verification`} />
        <Tile label="SMS" value={d.smsQueued} href="/sms" hint={d.smsFailed > 0 ? `${d.smsFailed} failed in the last 7 days` : 'queued · none failed this week'} alert={d.smsFailed > 0} />
        <Tile label="Failed sign-ins (24 h)" value={d.failedLogins24h} href="/audit?action=LOGIN_FAILED" hint={`${d.audit24h.toLocaleString('en-IN')} audit events in the last 24 h`} alert={d.failedLogins24h >= 5} />
      </section>

      {healthy && (
        <p className="flex items-center gap-2 text-sm font-semibold text-ok">
          <CheckCircle2 className="size-4" aria-hidden />Every active shop has a dealer, no SMS failures and no unusual sign-in failures.
        </p>
      )}

      <Card flush>
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-bold">Recent activity</h2>
          <Link href="/audit" className="text-sm font-semibold text-brand">Full audit log</Link>
        </div>
        {!recent.data ? (
          <Loading />
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {recent.data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-5 py-3 text-sm">
                <span>
                  <span className="font-semibold">{a.userName}</span> {describe(a)}
                  {a.action === 'LOGIN_FAILED' && <span className="ml-2 text-xs font-semibold text-bad">failed</span>}
                </span>
                <time dateTime={a.at} className="text-ink-3">{fmtAgo(a.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
