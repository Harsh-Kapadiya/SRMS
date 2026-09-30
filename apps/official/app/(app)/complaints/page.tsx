'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Paperclip } from 'lucide-react';
import { Badge, Card, Empty, Loading, PageHeader, Pager, cx, fmtAgo } from '@srms/ui';
import { api } from '@/lib/client';
import { ScopeFilters, scopeQuery, useScope } from '@/lib/scope';
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, type ComplaintRow, type ComplaintStatus, type Paged } from '@/lib/types';

const TABS: { value: ComplaintStatus | ''; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All' },
];

/** FR-9 complaint queue. */
export default function ComplaintsPage() {
  const scope = useScope();
  const [status, setStatus] = useState<ComplaintStatus | ''>('OPEN');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const q = new URLSearchParams(scopeQuery(scope, false));
  if (status) q.set('status', status);
  if (mine) q.set('mine', 'true');
  q.set('page', String(page));
  const res = api.useGet<Paged<ComplaintRow>>(`/official/complaints?${q}`);

  return (
    <>
      <PageHeader title="Complaints" subtitle="Beneficiary grievances routed to your office" />
      <ScopeFilters showMonth={false}>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} className="size-4 accent-[var(--brand)]" />
          Assigned to me
        </label>
      </ScopeFilters>

      <div role="tablist" aria-label="Status" className="no-print mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={status === t.value}
            onClick={() => { setStatus(t.value); setPage(1); }}
            className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', status === t.value ? 'bg-brand text-on-brand' : 'border border-line bg-surface text-ink-2 hover:bg-surface-3')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card flush>
        {!res.data ? (
          <Loading />
        ) : res.data.items.length === 0 ? (
          <Empty title="Nothing here" >No complaints match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Ticket</th><th>Category</th><th>Complaint</th><th>Shop</th><th>Status</th><th>Assigned to</th><th className="num">Filed</th></tr>
              </thead>
              <tbody>
                {res.data.items.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap"><Link href={`/complaints/${c.id}`} className="font-mono font-semibold text-brand hover:underline">{c.ticketNo}</Link></td>
                    <td className="whitespace-nowrap">{CATEGORY_LABEL[c.category] ?? c.category}</td>
                    <td className="max-w-sm"><p className="line-clamp-2">{c.description}</p><p className="text-xs text-ink-3">{c.beneficiary}{c.hasAttachment && <Paperclip className="ml-1 inline size-3" aria-label="has attachment" />}</p></td>
                    <td className="whitespace-nowrap">{c.shopName ?? '—'}<span className="block text-xs text-ink-3">{c.shopCode}</span></td>
                    <td><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge></td>
                    <td className="whitespace-nowrap">{c.assignedTo ?? '—'}</td>
                    <td className="num text-ink-3">{fmtAgo(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {res.data && <Pager page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage} />}
    </>
  );
}
