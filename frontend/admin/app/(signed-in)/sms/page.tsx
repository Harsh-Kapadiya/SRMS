'use client';
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Badge, Button, Card, Empty, Loading, PageHeader, Pager, Select, fmtDateTime, type Tone } from '@srms/ui-kit';
import { api } from '@/lib/admin-api';
import type { Paged, SmsRow } from '@/lib/admin-types';

const TONE: Record<SmsRow['status'], Tone> = { QUEUED: 'info', SENT: 'ok', DELIVERED: 'ok', FAILED: 'bad' };
const LABEL: Record<SmsRow['status'], string> = { QUEUED: 'Queued', SENT: 'Sent', DELIVERED: 'Delivered', FAILED: 'Failed' };

/** Outbound SMS (FR-7): what was sent to whom, and gateway failures. OTP texts are redacted after sending. */
export default function SmsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const res = api.useGet<Paged<SmsRow>>(`/admin/notifications?page=${page}${status ? `&status=${status}` : ''}`);

  async function retry() {
    setBusy(true);
    try {
      const r = await api.post<{ requeued: number }>('/admin/notifications/retry');
      setMsg(r.requeued ? `${r.requeued} failed ${r.requeued === 1 ? 'message was' : 'messages were'} queued again.` : 'No failed messages from the last 7 days to retry.');
      res.reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="SMS log"
        subtitle="Messages sent to beneficiaries and dealers through the SMS gateway"
        action={<Button variant="secondary" onClick={retry} loading={busy}><RotateCcw className="size-4" aria-hidden />Retry failed</Button>}
      />
      {msg && <p role="status" className="mb-4 text-sm font-semibold text-ink-2">{msg}</p>}
      <div className="mb-4">
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Status</span>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
            <option value="">All</option>
            {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </label>
      </div>
      <Card flush>
        {!res.data ? (
          <Loading />
        ) : res.data.items.length === 0 ? (
          <Empty title="No messages" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Queued</th><th>To</th><th>Message</th><th>Status</th><th className="num">Attempts</th></tr></thead>
              <tbody>
                {res.data.items.map((m) => (
                  <tr key={m.id} className="align-top">
                    <td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}<span className="block text-xs text-ink-3">{m.event.replace(/_/g, ' ').toLowerCase()}</span></td>
                    <td className="font-mono text-xs">{m.mobile ?? '—'}</td>
                    <td className="max-w-md text-sm">{m.message}{m.lastError && <span className="block text-xs text-bad">{m.lastError}</span>}</td>
                    <td><Badge tone={TONE[m.status]}>{LABEL[m.status]}</Badge>{m.sentAt && <span className="block text-xs text-ink-3">{fmtDateTime(m.sentAt)}</span>}</td>
                    <td className="num">{m.attempts}</td>
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
