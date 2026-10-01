'use client';
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Pager, Select, cx, fmtDate } from '@srms/ui-kit';
import { api } from '@/lib/official-api';
import { ScopeFilters, scopeQuery, useScope } from '@/lib/scope';
import type { BeneficiaryRow, Paged, ShopRow } from '@/lib/official-types';

const VERIFY_TONE = { PENDING: 'warn', VERIFIED: 'ok', REJECTED: 'bad' } as const;
const VERIFY_LABEL = { PENDING: 'Pending', VERIFIED: 'Verified', REJECTED: 'Failed' } as const;

export default function BeneficiariesPage() {
  const scope = useScope();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BeneficiaryRow | null>(null);
  const params = new URLSearchParams(scopeQuery(scope, false));
  params.set('page', String(page));
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  const res = api.useGet<Paged<BeneficiaryRow>>(`/official/beneficiaries?${params}`);

  return (
    <>
      <PageHeader title="Beneficiaries" subtitle="Registrations, Aadhaar verification and card categories" />
      <ScopeFilters showMonth={false}>
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Verification</span>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
            <option value="">All</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Failed</option>
          </Select>
        </label>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-ink-3">Name, card no., reg. no. or mobile</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          </label>
          <Button type="submit" variant="secondary" aria-label="Search"><Search className="size-4" /></Button>
        </form>
      </ScopeFilters>

      <Card flush>
        {!res.data ? (
          <Loading />
        ) : res.data.items.length === 0 ? (
          <Empty title="No beneficiaries match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Ration card</th><th>Category</th><th className="num">Family</th><th>Home shop</th><th>Aadhaar</th><th>Account</th><th>Registered</th><th /></tr></thead>
              <tbody>
                {res.data.items.map((b) => (
                  <tr key={b.id}>
                    <td className="font-semibold">{b.name}<span className="block text-xs font-normal text-ink-3">{b.mobileMasked} · {b.district}</span></td>
                    <td className="font-mono">{b.rationCardNo ?? <span className="text-ink-3">{b.registrationNo}</span>}</td>
                    <td>{b.cardType}</td>
                    <td className="num">{b.familySize}</td>
                    <td>{b.shopName ?? '—'}</td>
                    <td><Badge tone={VERIFY_TONE[b.verificationStatus]}>{VERIFY_LABEL[b.verificationStatus]}</Badge><span className="block whitespace-nowrap font-mono text-xs text-ink-3">{b.aadhaarMasked}</span></td>
                    <td><Badge tone={b.status === 'ACTIVE' ? 'ok' : 'bad'}>{b.status.toLowerCase()}</Badge></td>
                    <td className="whitespace-nowrap">{fmtDate(b.registeredAt)}</td>
                    <td><Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Review</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {res.data && <Pager page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage} />}
      {editing && <ReviewModal b={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload(); }} />}
    </>
  );
}

/** Officials correct the card category, move the home shop, or suspend an account. */
function ReviewModal({ b, onClose, onSaved }: { b: BeneficiaryRow; onClose: () => void; onSaved: () => void }) {
  const [cardType, setCardType] = useState(b.cardType);
  const [status, setStatus] = useState(b.status);
  const [shopId, setShopId] = useState('');
  const shops = api.useGet<ShopRow[]>('/official/shops');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/official/beneficiaries/${b.id}`, { cardType, status, ...(shopId ? { homeShopId: shopId } : {}) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={b.name}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <p className="text-sm text-ink-3">{b.rationCardNo ?? b.registrationNo} · family of {b.familySize} · Aadhaar {VERIFY_LABEL[b.verificationStatus].toLowerCase()}</p>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">Card category</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['PHH', 'AAY'] as const).map((c) => (
              <label key={c} className={cx('cursor-pointer rounded-xl border p-3 text-sm', cardType === c ? 'border-brand bg-brand-soft' : 'border-line')}>
                <input type="radio" className="sr-only" checked={cardType === c} onChange={() => setCardType(c)} />
                <span className="font-semibold">{c}</span>
                <span className="block text-ink-3">{c === 'PHH' ? '5 kg / person' : '35 kg / family + sugar'}</span>
              </label>
            ))}
          </div>
          {cardType !== b.cardType && <p className="mt-2 text-sm text-warn">Takes effect from next month&apos;s quota.</p>}
        </fieldset>
        <Field label="Home shop">
          {(id) => (
            <Select id={id} value={shopId} onChange={(e) => setShopId(e.target.value)}>
              <option value="">Keep {b.shopName ?? 'none'}</option>
              {shops.data?.filter((s) => s.district === b.district && s.status === 'ACTIVE').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Account">
          {(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended (cannot receive ration)</option><option value="INACTIVE">Inactive</option>
            </Select>
          )}
        </Field>
        {error && <Alert tone="bad" title={error} />}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" loading={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
