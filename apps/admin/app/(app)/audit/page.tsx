'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, Empty, Loading, PageHeader, Pager, Select, fmtDateTime } from '@srms/ui';
import { api } from '@/lib/client';
import { ACTIONS, ENTITIES, describe } from '@/lib/audit';
import { ROLE_LABEL, type AuditRow, type Paged } from '@/lib/types';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Field-level changes: UPDATE rows carry {field: {from, to}}, others a flat summary. */
function Changes({ changes }: { changes: AuditRow['changes'] }) {
  if (!changes || !Object.keys(changes).length) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-semibold text-brand">Details</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {Object.entries(changes).map(([k, v]) => {
          const diff = v && typeof v === 'object' && 'to' in v ? (v as { from?: unknown; to?: unknown }) : null;
          return (
            <div key={k} className="contents">
              <dt className="font-mono text-ink-3">{k}</dt>
              <dd className="break-all font-mono">{diff ? <>{show(diff.from)} → <strong>{show(diff.to)}</strong></> : show(v)}</dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

function Audit() {
  const params = useSearchParams();
  const [action, setAction] = useState(params.get('action') ?? '');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), ...(action ? { action } : {}), ...(entity ? { entity } : {}) });
  const res = api.useGet<Paged<AuditRow>>(`/admin/audit-logs?${query}`);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to records, sign-in and administrative action. Entries cannot be edited or deleted." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Action</span>
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-52">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>)}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Record type</span>
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="w-52">
            <option value="">All records</option>
            {ENTITIES.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </Select>
        </label>
      </div>
      <Card flush>
        {!res.data ? (
          <Loading />
        ) : res.data.items.length === 0 ? (
          <Empty title="No entries match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>IP address</th></tr></thead>
              <tbody>
                {res.data.items.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap">{fmtDateTime(a.at)}</td>
                    <td>{a.userName}<span className="block text-xs text-ink-3">{a.role ? ROLE_LABEL[a.role] ?? a.role : 'System'}</span></td>
                    <td className={a.action === 'LOGIN_FAILED' ? 'font-semibold text-bad' : undefined}>{describe(a)}<Changes changes={a.changes} /></td>
                    <td><span className="font-mono text-xs text-ink-3">{a.entityId ? a.entityId.slice(0, 13) : '—'}</span></td>
                    <td className="font-mono text-xs text-ink-3">{a.ip ?? '—'}</td>
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

export default function AuditPage() {
  return (
    <Suspense>
      <Audit />
    </Suspense>
  );
}
