'use client';
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { shopCreateSchema, shopUpdateSchema } from '@srms/shared';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from '@srms/ui';
import { api, useDistricts, validate } from '@/lib/client';
import type { Commodity, Dealer, Setting, Shop } from '@/lib/types';

const needsDealer = (s: Shop) => s.status === 'ACTIVE' && (!s.dealer || s.dealer.status !== 'ACTIVE');

export default function ShopsPage() {
  const res = api.useGet<Shop[]>('/admin/shops');
  const districts = useDistricts();
  const [district, setDistrict] = useState('');
  const [show, setShow] = useState<'all' | 'ACTIVE' | 'INACTIVE' | 'attention'>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Shop | 'new' | null>(null);
  const [quotas, setQuotas] = useState<Shop | null>(null);

  const needle = q.trim().toLowerCase();
  const rows = res.data?.filter(
    (s) =>
      (!district || s.districtId === Number(district)) &&
      (show === 'all' || (show === 'attention' ? needsDealer(s) : s.status === show)) &&
      (!needle || `${s.shopCode} ${s.name} ${s.address} ${s.dealer?.name ?? ''}`.toLowerCase().includes(needle)),
  );
  const attention = res.data?.filter(needsDealer).length ?? 0;

  return (
    <>
      <PageHeader
        title="Shops"
        subtitle="Fair price shops, the dealer running each one, and their monthly allocation"
        action={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Add shop</Button>}
      />
      {attention > 0 && show !== 'attention' && (
        <Alert
          tone="warn"
          title={`${attention} active ${attention === 1 ? 'shop has' : 'shops have'} no active dealer`}
          className="mb-4"
          action={<Button size="sm" variant="secondary" onClick={() => setShow('attention')}>Show</Button>}
        >
          Ration cannot be issued there until a dealer is assigned.
        </Alert>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">District</span>
          <Select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-52">
            <option value="">All districts</option>
            {districts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Show</span>
          <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="w-48">
            <option value="all">All shops</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="attention">Needs a dealer</option>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Code, name, address or dealer</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="w-72" type="search" />
        </label>
      </div>

      <Card flush>
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No shops match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Shop</th><th>District</th><th>Dealer</th><th>Monthly allocation</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.name}<span className="block text-xs font-normal text-ink-3">{s.shopCode} · {s.address}</span></td>
                    <td>{s.district.name}</td>
                    <td>
                      {s.dealer ? (
                        <>
                          {s.dealer.name}
                          <span className="block font-mono text-xs text-ink-3">{s.dealer.licenseNo}</span>
                          {s.dealer.status !== 'ACTIVE' && <Badge tone="bad"><AlertTriangle className="size-3" aria-hidden />Dealer {s.dealer.status.toLowerCase()}</Badge>}
                        </>
                      ) : (
                        <Badge tone={s.status === 'ACTIVE' ? 'bad' : 'neutral'}>{s.status === 'ACTIVE' && <AlertTriangle className="size-3" aria-hidden />}No dealer</Badge>
                      )}
                    </td>
                    <td className="text-sm">
                      {s.stock.length ? [...s.stock].sort((a, b) => a.commodityId - b.commodityId).map((st) => `${st.commodity.name} ${st.monthlyQuota.toLocaleString('en-IN')}`).join(' · ') + ' kg' : <span className="text-ink-3">Not set</span>}
                    </td>
                    <td><Badge tone={s.status === 'ACTIVE' ? 'ok' : 'neutral'}>{s.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuotas(s)}>Allocation</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ShopForm shop={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
      {quotas && <QuotaForm shop={quotas} onClose={() => setQuotas(null)} onSaved={res.reload} />}
    </>
  );
}

/** Create or edit a shop. The 3-shops-per-dealer and same-district rules are enforced by the database; the list below pre-filters. */
function ShopForm({ shop, onClose, onSaved }: { shop: Shop | null; onClose: () => void; onSaved: () => void }) {
  const districts = useDistricts();
  const dealers = api.useGet<Dealer[]>('/admin/dealers');
  const settings = api.useGet<Setting[]>('/admin/settings');
  const max = Number(settings.data?.find((s) => s.key === 'max_shops_per_dealer')?.value ?? 3);
  const [f, setF] = useState({
    shopCode: shop?.shopCode ?? '', name: shop?.name ?? '', address: shop?.address ?? '', districtId: shop ? String(shop.districtId) : '',
    dealerId: shop?.dealerId ?? '', latitude: shop?.latitude?.toString() ?? '', longitude: shop?.longitude?.toString() ?? '', status: shop?.status ?? 'ACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const candidates = dealers.data?.filter((d) => d.status === 'ACTIVE' && d.districtId === Number(f.districtId));
  const load = (d: Dealer) => d.shops.filter((s) => s.status === 'ACTIVE' && s.id !== shop?.id).length;

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: f.name, address: f.address, districtId: f.districtId || undefined, dealerId: f.dealerId || null,
      latitude: f.latitude || undefined, longitude: f.longitude || undefined,
      ...(shop ? { status: f.status } : { shopCode: f.shopCode }),
    };
    const v = validate(shop ? shopUpdateSchema : shopCreateSchema, payload);
    setErrors(v.errors ?? {});
    if (!v.data) return;
    setBusy(true);
    setError(undefined);
    try {
      if (shop) await api.patch(`/admin/shops/${shop.id}`, v.data);
      else await api.post('/admin/shops', v.data);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={shop ? `Edit ${shop.shopCode}` : 'Add shop'}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          {shop ? (
            <Field label="Shop code">{(id) => <Input id={id} value={shop.shopCode} disabled />}</Field>
          ) : (
            <Field label="Shop code" error={errors.shopCode}>{(id) => <Input id={id} value={f.shopCode} onChange={set('shopCode')} placeholder="FPS-PAT-0006" className="uppercase" />}</Field>
          )}
          <Field label="Shop name" error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={set('name')} />}</Field>
        </div>
        <Field label="Address" error={errors.address}>{(id) => <Textarea id={id} value={f.address} onChange={set('address')} className="min-h-16" />}</Field>
        <Field label="District" error={errors.districtId}>
          {(id) => (
            <Select id={id} value={f.districtId} onChange={(e) => setF({ ...f, districtId: e.target.value, dealerId: '' })}>
              <option value="">Choose…</option>
              {districts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Dealer" hint={f.districtId ? `Active dealers in this district. A dealer can run up to ${max} active shops.` : 'Choose the district first.'}>
          {(id) => (
            <Select id={id} value={f.dealerId} onChange={set('dealerId')} disabled={!f.districtId}>
              <option value="">No dealer yet</option>
              {candidates?.map((d) => {
                const n = load(d);
                return <option key={d.id} value={d.id} disabled={n >= max && d.id !== shop?.dealerId}>{d.name} — {n} of {max} shops{n >= max ? ' (full)' : ''}</option>;
              })}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude (optional)" error={errors.latitude}>{(id) => <Input id={id} inputMode="decimal" value={f.latitude} onChange={set('latitude')} />}</Field>
          <Field label="Longitude (optional)" error={errors.longitude}>{(id) => <Input id={id} inputMode="decimal" value={f.longitude} onChange={set('longitude')} />}</Field>
        </div>
        {shop && (
          <Field label="Shop status" hint={f.status === 'INACTIVE' ? 'An inactive shop is closed: no ration is issued there and it stops counting towards its dealer’s limit.' : undefined}>
            {(id) => (
              <Select id={id} value={f.status} onChange={set('status')}>
                <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive (closed)</option>
              </Select>
            )}
          </Field>
        )}
        {error && <Alert tone="bad" title={error} />}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" loading={busy}>{shop ? 'Save changes' : 'Create shop'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Monthly allocation per commodity; the low-stock alert fires below the configured % of it (SRS R5). */
function QuotaForm({ shop, onClose, onSaved }: { shop: Shop; onClose: () => void; onSaved: () => void }) {
  const commodities = api.useGet<Commodity[]>('/admin/commodities');
  const settings = api.useGet<Setting[]>('/admin/settings');
  const pct = Number(settings.data?.find((s) => s.key === 'low_stock_pct')?.value ?? 20);
  const [values, setValues] = useState<Record<number, string>>(Object.fromEntries(shop.stock.map((s) => [s.commodityId, String(s.monthlyQuota)])));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const items = (commodities.data ?? []).filter((c) => values[c.id] !== undefined && values[c.id] !== '').map((c) => ({ commodityId: c.id, monthlyQuota: Number(values[c.id]) }));
    if (!items.length || items.some((i) => !Number.isFinite(i.monthlyQuota) || i.monthlyQuota < 0)) return setError('Enter a quantity of 0 or more for each commodity.');
    setBusy(true);
    setError(undefined);
    try {
      await api.put(`/admin/shops/${shop.id}/quotas`, { items });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Monthly allocation — ${shop.name}`}>
      {!commodities.data ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="space-y-4" noValidate>
          <p className="text-sm text-ink-2">Quantity this shop receives each month. The dealer gets a low-stock alert when stock falls below {pct}% of it.</p>
          {commodities.data.filter((c) => c.isActive).map((c) => {
            const v = Number(values[c.id] ?? 0);
            return (
              <Field key={c.id} label={`${c.name} (${c.unit === 'KG' ? 'kg' : c.unit.toLowerCase()})`} hint={v > 0 ? `Alert below ${Math.round(v * pct) / 100} ${c.unit === 'KG' ? 'kg' : c.unit.toLowerCase()}` : undefined}>
                {(id) => <Input id={id} type="number" min={0} step="0.5" inputMode="decimal" value={values[c.id] ?? ''} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} />}
              </Field>
            );
          })}
          {error && <Alert tone="bad" title={error} />}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={busy}>Save allocation</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
