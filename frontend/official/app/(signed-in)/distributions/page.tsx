'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, Pager, Textarea, fmtDateTime, fmtMoney } from '@srms/ui-kit';
import { api } from '@/lib/official-api';
import { ScopeFilters, scopeQuery, useScope } from '@/lib/scope';
import type { DistributionRow, Paged, Receipt } from '@/lib/official-types';

const AUTH: Record<string, string> = { OTP: 'Aadhaar OTP', BIOMETRIC: 'Biometric', OFFLINE: 'Offline', MANUAL: 'Manual' };

function Distributions() {
  const scope = useScope();
  const shopId = useSearchParams().get('shopId');
  const [offline, setOffline] = useState(false);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = new URLSearchParams(scopeQuery(scope));
  q.set('page', String(page));
  if (shopId) q.set('shopId', shopId);
  if (offline) q.set('offline', 'true');
  const res = api.useGet<Paged<DistributionRow>>(`/official/distributions?${q}`);

  return (
    <>
      <PageHeader title="Distributions" subtitle={shopId ? 'Transactions at one shop' : 'Every ration receipt issued'} />
      <ScopeFilters>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={offline} onChange={(e) => { setOffline(e.target.checked); setPage(1); }} className="size-4 accent-[var(--brand)]" />
          Recorded offline only
        </label>
      </ScopeFilters>
      <Card flush>
        {!res.data ? (
          <Loading />
        ) : res.data.items.length === 0 ? (
          <Empty title="No transactions">Nothing matches this month and filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Beneficiary</th><th>Shop</th><th>Items</th><th>Verified by</th><th>Status</th></tr></thead>
              <tbody>
                {res.data.items.map((d) => (
                  <tr key={d.id}>
                    <td><button type="button" onClick={() => setOpenId(d.id)} className="font-mono font-semibold text-brand hover:underline">{d.receiptNo}</button></td>
                    <td className="whitespace-nowrap">{fmtDateTime(d.issuedAt)}</td>
                    <td>{d.beneficiaryName}<span className="block font-mono text-xs text-ink-3">{d.rationCardNo}</span></td>
                    <td>{d.shopName}<span className="block text-xs text-ink-3">{d.shopCode}</span></td>
                    <td className="whitespace-nowrap">{d.items.map((i) => `${i.name} ${i.quantity}`).join(' · ')}</td>
                    <td>{d.syncedLate ? <Badge tone="bad">Offline · synced late</Badge> : d.offline ? <Badge tone="warn">Offline</Badge> : AUTH[d.authMethod] ?? d.authMethod}</td>
                    <td>{d.status === 'VOIDED' ? <Badge tone="bad">Voided</Badge> : <Badge tone="ok">Completed</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {res.data && <Pager page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage} />}
      <ReceiptModal id={openId} onClose={() => setOpenId(null)} onVoided={res.reload} />
    </>
  );
}

function ReceiptModal({ id, onClose, onVoided }: { id: string | null; onClose: () => void; onVoided: () => void }) {
  const r = api.useGet<Receipt>(id ? `/official/distributions/${id}` : null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function voidIt(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Give a reason (5+ characters). It goes into the audit log.');
    setBusy(true);
    try {
      await api.post(`/official/distributions/${id}/void`, { reason });
      setVoiding(false);
      setReason('');
      r.reload();
      onVoided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const d = r.data && r.data.id === id ? r.data : null;
  return (
    <Modal open={id !== null} onClose={() => { setVoiding(false); onClose(); }} title={d ? `Receipt ${d.receiptNo}` : 'Receipt'}>
      {!d ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {d.status === 'VOIDED' && <Alert tone="bad" title="Voided — quota and stock were returned through the ledger." />}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-3">Date</dt><dd className="font-semibold">{fmtDateTime(d.issuedAt)}</dd></div>
            <div><dt className="text-ink-3">Verified by</dt><dd className="font-semibold">{AUTH[d.authMethod] ?? d.authMethod}{d.capturedOfflineAt && ' (synced later)'}</dd></div>
            <div><dt className="text-ink-3">Beneficiary</dt><dd className="font-semibold">{d.beneficiary.name}</dd><dd className="text-ink-3">{d.beneficiary.rationCardNo} · {d.beneficiary.cardType} · {d.beneficiary.aadhaarMasked}</dd></div>
            <div><dt className="text-ink-3">Shop / dealer</dt><dd className="font-semibold">{d.shop.name}</dd><dd className="text-ink-3">{d.dealer.name} · {d.dealer.licenseNo}</dd></div>
          </dl>
          <table className="data-table">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
            <tbody>{d.items.map((i) => <tr key={i.commodityId}><td>{i.name}</td><td className="num">{i.quantity} {i.unit === 'KG' ? 'kg' : i.unit}</td><td className="num">{fmtMoney(i.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2} className="font-bold">Total</td><td className="num font-bold">{fmtMoney(d.totalAmount)}</td></tr></tfoot>
          </table>
          {d.status === 'COMPLETED' && (voiding ? (
            <form onSubmit={voidIt} className="space-y-3 rounded-xl border border-bad/40 p-4" noValidate>
              <Field label="Why is this transaction wrong?" error={error}>
                {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-20" autoFocus />}
              </Field>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setVoiding(false)}>Cancel</Button>
                <Button type="submit" variant="danger" loading={busy}>Void receipt</Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" block onClick={() => { setVoiding(true); setError(undefined); }}>Void this receipt…</Button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function DistributionsPage() {
  return (
    <Suspense>
      <Distributions />
    </Suspense>
  );
}
