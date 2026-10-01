'use client';
import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, Field, Input, Loading, Meter, Modal, Select, Textarea, cx, fmtDateTime } from '@srms/ui-kit';
import { fmtKg } from '@/components/bits';
import { api } from '@/lib/official-api';
import type { Movement, StockLine } from '@/lib/official-types';

interface ShopDetail {
  shop: { id: string; shopCode: string; name: string; address: string; status: string };
  stock: StockLine[];
  movements: Movement[];
}

const REASON: Record<string, string> = {
  DAMAGE: 'Damage', EXPIRY: 'Expiry', INSPECTION_SHORTAGE: 'Inspection shortage', INSPECTION_EXCESS: 'Inspection excess',
  CORRECTION: 'Correction', VOID_REVERSAL: 'Voided receipt reversed',
};

/** Shop stock, its ledger (receipts & adjustments), and physical inspection → leakage. */
export default function ShopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const res = api.useGet<ShopDetail>(`/official/shops/${id}`);
  const [inspecting, setInspecting] = useState(false);
  const [form, setForm] = useState({ commodityId: '', physicalQuantity: '', note: '' });
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ ledger: number; physical: number; difference: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function inspect(e: FormEvent) {
    e.preventDefault();
    if (!form.commodityId || form.physicalQuantity === '' || form.note.trim().length < 3) return setError('Choose a commodity, enter the counted quantity and a short note.');
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ ledger: number; physical: number; difference: number }>('/official/inspections', {
        shopId: id, commodityId: Number(form.commodityId), physicalQuantity: Number(form.physicalQuantity), note: form.note,
      });
      setResult(r);
      res.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!res.data) return res.error ? <Alert tone="bad" title={res.error.message} /> : <Loading />;
  const { shop, stock, movements } = res.data;
  const unit = (u: string) => (u === 'KG' ? 'kg' : u.toLowerCase());

  return (
    <div className="space-y-5">
      <Link href="/shops" className="no-print inline-flex items-center gap-1.5 font-semibold text-brand"><ArrowLeft className="size-4" aria-hidden />All shops</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{shop.name}</h1>
          <p className="text-ink-3">{shop.shopCode} · {shop.address}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/distributions?shopId=${shop.id}`}><Button variant="secondary">Transactions</Button></Link>
          <Button onClick={() => { setInspecting(true); setResult(null); setError(undefined); setForm({ commodityId: '', physicalQuantity: '', note: '' }); }}>
            <ClipboardCheck className="size-4" aria-hidden />Record inspection
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {stock.map((s) => (
          <Card key={s.commodityId}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{s.name}</h2>
              {s.isLow ? <Badge tone="bad">Low stock</Badge> : <Badge tone="ok">OK</Badge>}
            </div>
            <p className="mt-2 text-3xl font-bold">{s.quantityAvailable.toLocaleString('en-IN')} <span className="text-base font-semibold text-ink-3">{unit(s.unit)}</span></p>
            <div className="mt-3"><Meter value={s.quantityAvailable} max={Math.max(s.monthlyQuota, s.quantityAvailable)} tone={s.isLow ? 'bad' : 'brand'} label={`${s.name} stock`} /></div>
            <p className="mt-1.5 text-xs text-ink-3">Monthly quota {fmtKg(s.monthlyQuota)} · alert below {fmtKg(s.lowStockThreshold)}</p>
          </Card>
        ))}
      </section>

      <Card flush>
        <h2 className="px-5 pt-5 font-bold">Stock ledger</h2>
        <p className="px-5 text-sm text-ink-3">Receipts and adjustments (issues to beneficiaries are under Transactions). Ledger rows cannot be edited or deleted.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Commodity</th><th>Type</th><th className="num">Quantity</th><th className="num">Balance after</th><th>Reference / note</th><th>By</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(m.occurredAt)}</td>
                  <td>{m.commodity}</td>
                  <td>{m.type === 'RECEIPT' ? <Badge tone="info">Receipt</Badge> : <Badge tone={m.reason === 'INSPECTION_SHORTAGE' ? 'bad' : 'neutral'}>{REASON[m.reason ?? ''] ?? m.reason}</Badge>}</td>
                  <td className={cx('num font-semibold', m.quantity < 0 ? 'text-bad' : 'text-ok')}>{m.quantity > 0 ? '+' : ''}{m.quantity.toLocaleString('en-IN')} {unit(m.unit)}</td>
                  <td className="num">{m.balanceAfter.toLocaleString('en-IN')}</td>
                  <td className="max-w-xs"><span className="font-mono text-xs">{m.referenceNo}</span>{m.note && <span className="block text-xs text-ink-3">{m.note}</span>}</td>
                  <td className="whitespace-nowrap text-ink-3">{m.by ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={inspecting} onClose={() => setInspecting(false)} title="Record physical inspection">
        {result ? (
          <div className="space-y-4">
            <Alert
              tone={result.difference === 0 ? 'ok' : result.difference < 0 ? 'bad' : 'warn'}
              title={result.difference === 0 ? 'Stock matches the ledger' : result.difference < 0 ? `Shortage of ${fmtKg(-result.difference)} recorded as leakage` : `Excess of ${fmtKg(result.difference)} recorded`}
            >
              Ledger said {fmtKg(result.ledger)}; counted {fmtKg(result.physical)}. The adjustment is in the ledger and the audit log.
            </Alert>
            <Button block onClick={() => setInspecting(false)}>Done</Button>
          </div>
        ) : (
          <form onSubmit={inspect} className="space-y-4" noValidate>
            <p className="text-sm text-ink-2">Count the stock physically. Any difference from the system balance is recorded as an inspection shortage (leakage) or excess.</p>
            <Field label="Commodity">
              {(fid) => (
                <Select id={fid} value={form.commodityId} onChange={(e) => setForm({ ...form, commodityId: e.target.value })}>
                  <option value="">Choose…</option>
                  {stock.map((s) => <option key={s.commodityId} value={s.commodityId}>{s.name} — system shows {fmtKg(s.quantityAvailable)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Counted quantity (kg)">
              {(fid) => <Input id={fid} type="number" inputMode="decimal" min={0} step="0.5" value={form.physicalQuantity} onChange={(e) => setForm({ ...form, physicalQuantity: e.target.value })} />}
            </Field>
            <Field label="Note">
              {(fid) => <Textarea id={fid} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Surprise inspection with the block supply officer" className="min-h-20" />}
            </Field>
            {error && <Alert tone="bad" title={error} />}
            <Button type="submit" block loading={busy}>Save inspection</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
