'use client';
import { useState, type FormEvent } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { dealerCreateSchema, dealerUpdateSchema } from '@srms/shared';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea, fmtAgo, fmtDate } from '@srms/ui-kit';
import { Credentials } from '@/components/credentials';
import { api, useDistricts, validate } from '@/lib/admin-api';
import { STATUS_LABEL, STATUS_TONE, type Dealer, type Login, type Setting } from '@/lib/admin-types';

const DAY = 86_400_000;
/** Licence expired, or expiring within 60 days. */
function licence(until: string | null) {
  if (!until) return null;
  const days = (new Date(until).getTime() - Date.now()) / DAY;
  return days < 0 ? { tone: 'bad' as const, text: 'Expired' } : days < 60 ? { tone: 'warn' as const, text: 'Expires soon' } : null;
}

export default function DealersPage() {
  const res = api.useGet<Dealer[]>('/admin/dealers');
  const settings = api.useGet<Setting[]>('/admin/settings');
  const districts = useDistricts();
  const [district, setDistrict] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Dealer | 'new' | null>(null);
  const max = Number(settings.data?.find((s) => s.key === 'max_shops_per_dealer')?.value ?? 3);

  const needle = q.trim().toLowerCase();
  const rows = res.data?.filter(
    (d) => (!district || d.districtId === Number(district)) && (!needle || `${d.name} ${d.licenseNo} ${d.user.email} ${d.mobile}`.toLowerCase().includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Dealers"
        subtitle={`Fair price shop dealers. Each dealer runs at most ${max} shops, all in their own district.`}
        action={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Add dealer</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">District</span>
          <Select value={district} onChange={(e) => setDistrict(e.target.value)} className="w-52">
            <option value="">All districts</option>
            {districts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Name, licence, email or mobile</span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="w-72" type="search" />
        </label>
      </div>

      <Card flush>
        {!rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No dealers match">Change the filters, or add a dealer.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Dealer</th><th>Licence</th><th>District</th><th>Shops</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((d) => {
                  const lic = licence(d.licenseValidUntil);
                  const active = d.shops.filter((s) => s.status === 'ACTIVE');
                  return (
                    <tr key={d.id}>
                      <td className="font-semibold">{d.name}<span className="block text-xs font-normal text-ink-3">{d.user.email} · {d.mobile}</span></td>
                      <td>
                        <span className="font-mono text-xs">{d.licenseNo}</span>
                        <span className="block text-xs text-ink-3">
                          {d.licenseValidUntil ? `valid until ${fmtDate(d.licenseValidUntil)}` : 'no expiry recorded'}
                        </span>
                        {lic && <Badge tone={lic.tone} className="mt-1"><AlertTriangle className="size-3" aria-hidden />{lic.text}</Badge>}
                      </td>
                      <td>{d.district.name}</td>
                      <td>
                        <span className="font-semibold tabular-nums">{active.length} of {max}</span>
                        <span className="block text-xs text-ink-3">{active.map((s) => s.shopCode).join(', ') || 'No shops yet'}</span>
                      </td>
                      <td className="whitespace-nowrap text-ink-3">{d.user.lastLoginAt ? fmtAgo(d.user.lastLoginAt) : 'Never'}</td>
                      <td><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></td>
                      <td><Button size="sm" variant="ghost" onClick={() => setEditing(d)}>Edit</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <DealerForm dealer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
    </>
  );
}

/** Create (email + temporary password) or edit a dealer. Suspending signs them out everywhere. */
function DealerForm({ dealer, onClose, onSaved }: { dealer: Dealer | null; onClose: () => void; onSaved: () => void }) {
  const districts = useDistricts();
  const [f, setF] = useState({
    name: dealer?.name ?? '', email: '', mobile: dealer?.mobile ?? '', licenseNo: dealer?.licenseNo ?? '',
    licenseValidUntil: dealer?.licenseValidUntil ?? '', districtId: dealer ? String(dealer.districtId) : '', address: dealer?.address ?? '',
    status: dealer?.status ?? 'ACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Login | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: f.name, mobile: f.mobile, licenseNo: f.licenseNo, licenseValidUntil: f.licenseValidUntil || undefined,
      districtId: f.districtId || undefined, address: f.address.trim() || undefined,
      ...(dealer ? { status: f.status } : { email: f.email }),
    };
    const v = validate(dealer ? dealerUpdateSchema : dealerCreateSchema, payload);
    setErrors(v.errors ?? {});
    if (!v.data) return;
    setBusy(true);
    setError(undefined);
    try {
      if (dealer) {
        await api.patch(`/admin/dealers/${dealer.id}`, v.data);
        onSaved();
        onClose();
      } else {
        const r = await api.post<{ login: Login }>('/admin/dealers', v.data);
        onSaved();
        setLogin(r.login);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={login ? 'Dealer account created' : dealer ? `Edit ${dealer.name}` : 'Add dealer'}>
      {login ? (
        <Credentials login={login} onDone={onClose} />
      ) : (
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="Full name" error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={set('name')} autoComplete="off" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {!dealer && <Field label="Email (sign-in)" error={errors.email}>{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} autoComplete="off" />}</Field>}
            <Field label="Mobile" error={errors.mobile}>{(id) => <Input id={id} inputMode="numeric" maxLength={10} value={f.mobile} onChange={set('mobile')} />}</Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Licence number" error={errors.licenseNo}>{(id) => <Input id={id} value={f.licenseNo} onChange={set('licenseNo')} placeholder="BR/PAT/FPS/2026/0001" />}</Field>
            <Field label="Licence valid until" error={errors.licenseValidUntil}>{(id) => <Input id={id} type="date" value={f.licenseValidUntil} onChange={set('licenseValidUntil')} />}</Field>
          </div>
          <Field
            label="District"
            error={errors.districtId}
            hint={dealer && dealer.shops.some((s) => s.status === 'ACTIVE') ? 'Shops must be in the dealer’s district — move or reassign them first to change this.' : undefined}
          >
            {(id) => (
              <Select id={id} value={f.districtId} onChange={set('districtId')}>
                <option value="">Choose…</option>
                {districts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Address (optional)">{(id) => <Textarea id={id} value={f.address} onChange={set('address')} className="min-h-16" />}</Field>
          {dealer && (
            <Field label="Account" hint={f.status !== 'ACTIVE' ? 'The dealer is signed out at once and cannot issue ration until reactivated.' : undefined}>
              {(id) => (
                <Select id={id} value={f.status} onChange={set('status')}>
                  <option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="INACTIVE">Inactive (left the scheme)</option>
                </Select>
              )}
            </Field>
          )}
          {error && <Alert tone="bad" title={error} />}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={busy}>{dealer ? 'Save changes' : 'Create dealer account'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
