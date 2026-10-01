'use client';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { commoditySchema } from '@srms/shared';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, fmtMoney, fmtMonth } from '@srms/ui-kit';
import { api, thisMonth, validate } from '@/lib/admin-api';
import type { Commodity, EntitlementRule } from '@/lib/admin-types';

const unitLabel = (u: string) => (u === 'KG' ? 'kg' : u.toLowerCase());

export default function CommoditiesPage() {
  const res = api.useGet<Commodity[]>('/admin/commodities');
  const [editing, setEditing] = useState<Commodity | 'new' | null>(null);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Commodities & quotas"
        subtitle="What shops distribute, how much each card is entitled to, and the monthly quotas"
        action={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Add commodity</Button>}
      />
      <Card flush>
        <h2 className="px-5 pt-5 font-bold">Commodities</h2>
        {!res.data ? (
          <Loading />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Commodity</th><th>Hindi name</th><th>Unit</th><th className="num">Price to beneficiary</th><th>Status</th><th /></tr></thead>
              <tbody>
                {res.data.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.name}<span className="block font-mono text-xs font-normal text-ink-3">{c.code}</span></td>
                    <td lang="hi">{c.nameHi ?? '—'}</td>
                    <td>{unitLabel(c.unit)}</td>
                    <td className="num">{c.pricePerUnit === 0 ? 'Free' : `${fmtMoney(c.pricePerUnit)} / ${unitLabel(c.unit)}`}</td>
                    <td><Badge tone={c.isActive ? 'ok' : 'neutral'}>{c.isActive ? 'Distributed' : 'Not distributed'}</Badge></td>
                    <td><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {res.data && <Entitlements commodities={res.data.filter((c) => c.isActive)} />}
      <GenerateQuotas />
      {editing && <CommodityForm commodity={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
    </div>
  );
}

type Grid = Record<string, { qtyPerMember: string; qtyPerFamily: string }>;
const CARDS = [
  { type: 'PHH', label: 'Priority household (PHH)' },
  { type: 'AAY', label: 'Antyodaya (AAY)' },
] as const;

/** Monthly entitlement per card type: a per-person amount, a per-family amount, or both (NFSA: PHH 5 kg/person, AAY 35 kg/family). */
function Entitlements({ commodities }: { commodities: Commodity[] }) {
  const res = api.useGet<EntitlementRule[]>('/admin/entitlements');
  const [grid, setGrid] = useState<Grid>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  useEffect(() => {
    if (!res.data) return;
    const g: Grid = {};
    for (const c of commodities) for (const { type } of CARDS) g[`${c.id}:${type}`] = { qtyPerMember: '0', qtyPerFamily: '0' };
    for (const r of res.data) if (r.isActive) g[`${r.commodityId}:${r.cardType}`] = { qtyPerMember: String(r.qtyPerMember), qtyPerFamily: String(r.qtyPerFamily) };
    setGrid(g);
  }, [res.data, commodities]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const rules = Object.entries(grid).map(([k, v]) => {
      const [commodityId, cardType] = k.split(':');
      const qtyPerMember = Number(v.qtyPerMember || 0);
      const qtyPerFamily = Number(v.qtyPerFamily || 0);
      return { commodityId: Number(commodityId), cardType: cardType as 'PHH' | 'AAY', qtyPerMember, qtyPerFamily, isActive: qtyPerMember > 0 || qtyPerFamily > 0 };
    });
    if (rules.some((r) => !(r.qtyPerMember >= 0 && r.qtyPerFamily >= 0))) return setMsg({ tone: 'bad', text: 'Quantities must be 0 or more.' });
    setBusy(true);
    try {
      await api.put('/admin/entitlements', { rules });
      setMsg({ tone: 'ok', text: 'Saved. New quotas use these amounts; quotas already created for this month are unchanged.' });
      res.reload();
    } catch (err) {
      setMsg({ tone: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const cell = (key: string, field: 'qtyPerMember' | 'qtyPerFamily', label: string) => (
    <Input
      type="number" min={0} step="0.5" inputMode="decimal" aria-label={label} className="w-24 text-right"
      value={grid[key]?.[field] ?? ''} onChange={(e) => setGrid({ ...grid, [key]: { ...grid[key]!, [field]: e.target.value } })}
    />
  );

  return (
    <Card flush>
      <form onSubmit={save} noValidate>
        <h2 className="px-5 pt-5 font-bold">Monthly entitlement</h2>
        <p className="px-5 text-sm text-ink-3">A family’s quota = per-person amount × family members + per-family amount.</p>
        {!res.data ? (
          <Loading />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Commodity</th>
                  {CARDS.map((c) => <th key={c.type} colSpan={2} className="text-center">{c.label}</th>)}
                </tr>
                <tr>{CARDS.map((c) => <Fragment key={c.type}><th className="num">per person</th><th className="num">per family</th></Fragment>)}</tr>
              </thead>
              <tbody>
                {commodities.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.name} <span className="font-normal text-ink-3">({unitLabel(c.unit)})</span></td>
                    {CARDS.map(({ type }) => (
                      <Fragment key={type}>
                        <td className="num">{cell(`${c.id}:${type}`, 'qtyPerMember', `${c.name}, ${type}, per person`)}</td>
                        <td className="num">{cell(`${c.id}:${type}`, 'qtyPerFamily', `${c.name}, ${type}, per family`)}</td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 p-5">
          <Button type="submit" loading={busy}>Save entitlement</Button>
          {msg && <span className={msg.tone === 'ok' ? 'text-sm font-semibold text-ok' : 'text-sm font-semibold text-bad'} role="status">{msg.text}</span>}
        </div>
      </form>
    </Card>
  );
}

/** Quotas are created automatically each month and when a beneficiary is verified; this fills any gaps now. */
function GenerateQuotas() {
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  async function run() {
    setBusy(true);
    try {
      const r = await api.post<{ created: number }>('/admin/quotas/generate', { month });
      setMsg({ tone: 'ok', text: r.created ? `Created ${r.created} missing ${r.created === 1 ? 'quota' : 'quotas'} for ${fmtMonth(month)}.` : `Every verified beneficiary already has a quota for ${fmtMonth(month)}.` });
    } catch (err) {
      setMsg({ tone: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2 className="font-bold">Monthly quotas</h2>
      <p className="mt-1 text-sm text-ink-3">Created automatically on the 1st of each month and whenever a beneficiary is verified. Run this if a month is missing quotas.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Month</span>
          <Input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} className="w-48" />
        </label>
        <Button variant="secondary" loading={busy} onClick={run} disabled={!month}>Create missing quotas</Button>
      </div>
      {msg && <p className={msg.tone === 'ok' ? 'mt-3 text-sm font-semibold text-ok' : 'mt-3 text-sm font-semibold text-bad'} role="status">{msg.text}</p>}
    </Card>
  );
}

function CommodityForm({ commodity, onClose, onSaved }: { commodity: Commodity | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: commodity?.code ?? '', name: commodity?.name ?? '', nameHi: commodity?.nameHi ?? '', unit: commodity?.unit ?? 'KG',
    pricePerUnit: String(commodity?.pricePerUnit ?? 0), sortOrder: String(commodity?.sortOrder ?? 10), isActive: commodity?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const v = validate(commoditySchema, { ...f, code: commodity?.code ?? f.code, nameHi: f.nameHi.trim() || undefined });
    setErrors(v.errors ?? {});
    if (!v.data) return;
    setBusy(true);
    setError(undefined);
    try {
      if (commodity) {
        const { code: _code, ...patch } = v.data;
        await api.patch(`/admin/commodities/${commodity.id}`, patch);
      } else {
        await api.post('/admin/commodities', v.data);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={commodity ? `Edit ${commodity.name}` : 'Add commodity'}>
      <form onSubmit={save} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" error={errors.code} hint={commodity ? 'The code cannot change.' : 'Short and permanent, e.g. DAL.'}>
            {(id) => <Input id={id} value={commodity?.code ?? f.code} onChange={set('code')} disabled={Boolean(commodity)} className="uppercase" />}
          </Field>
          <Field label="Unit">
            {(id) => (
              <Select id={id} value={f.unit} onChange={set('unit')}>
                <option value="KG">Kilogram</option><option value="LITRE">Litre</option><option value="PACKET">Packet</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name (English)" error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={set('name')} />}</Field>
          <Field label="Name (Hindi)" hint="Shown in the dealer and beneficiary apps.">{(id) => <Input id={id} lang="hi" value={f.nameHi} onChange={set('nameHi')} />}</Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price per unit (₹)" error={errors.pricePerUnit} hint="0 means free.">{(id) => <Input id={id} type="number" min={0} step="0.01" value={f.pricePerUnit} onChange={set('pricePerUnit')} />}</Field>
          <Field label="Display order">{(id) => <Input id={id} type="number" value={f.sortOrder} onChange={set('sortOrder')} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} className="size-4 accent-[var(--brand)]" />
          Distributed through ration shops
        </label>
        {error && <Alert tone="bad" title={error} />}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" loading={busy}>{commodity ? 'Save changes' : 'Add commodity'}</Button>
        </div>
      </form>
    </Modal>
  );
}
