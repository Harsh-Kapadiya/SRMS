'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { officialCreateSchema, officialUpdateSchema } from '@srms/shared';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, fmtAgo } from '@srms/ui-kit';
import { Credentials } from '@/components/credentials';
import { api, useDistricts, validate } from '@/lib/admin-api';
import { STATUS_LABEL, STATUS_TONE, type Login, type Official } from '@/lib/admin-types';

/** Government officials: state level (all districts) or a district supply officer (one district only). */
export default function OfficialsPage() {
  const res = api.useGet<Official[]>('/admin/officials');
  const [editing, setEditing] = useState<Official | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Officials"
        subtitle="State-level officials see every district; a district officer sees only their own."
        action={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Add official</Button>}
      />
      <Card flush>
        {!res.data ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Official</th><th>Designation</th><th>Scope</th><th>Last sign-in</th><th>Account</th><th /></tr></thead>
              <tbody>
                {res.data.map((o) => (
                  <tr key={o.id}>
                    <td className="font-semibold">{o.name}<span className="block text-xs font-normal text-ink-3">{o.user.email} · {o.mobile}</span></td>
                    <td>{o.designation}</td>
                    <td>{o.district ? `${o.district.name} district` : <Badge tone="info">Whole state</Badge>}</td>
                    <td className="whitespace-nowrap text-ink-3">{o.user.lastLoginAt ? fmtAgo(o.user.lastLoginAt) : 'Never'}</td>
                    <td><Badge tone={STATUS_TONE[o.user.status]}>{STATUS_LABEL[o.user.status]}</Badge></td>
                    <td><Button size="sm" variant="ghost" onClick={() => setEditing(o)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-sm text-ink-3">To suspend an official or reset their password, use <Link href="/users?role=OFFICIAL" className="font-semibold text-brand">All users</Link>.</p>
      {editing && <OfficialForm official={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
    </>
  );
}

function OfficialForm({ official, onClose, onSaved }: { official: Official | null; onClose: () => void; onSaved: () => void }) {
  const districts = useDistricts();
  const [f, setF] = useState({
    name: official?.name ?? '', email: '', mobile: official?.mobile ?? '', designation: official?.designation ?? '',
    districtId: official?.districtId ? String(official.districtId) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<Login | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const payload = { name: f.name, mobile: f.mobile, designation: f.designation, districtId: f.districtId ? Number(f.districtId) : null, ...(official ? {} : { email: f.email }) };
    const v = validate(official ? officialUpdateSchema : officialCreateSchema, payload);
    setErrors(v.errors ?? {});
    if (!v.data) return;
    setBusy(true);
    setError(undefined);
    try {
      if (official) {
        await api.patch(`/admin/officials/${official.id}`, v.data);
        onSaved();
        onClose();
      } else {
        const r = await api.post<{ login: Login }>('/admin/officials', v.data);
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
    <Modal open onClose={onClose} title={login ? 'Official account created' : official ? `Edit ${official.name}` : 'Add official'}>
      {login ? (
        <Credentials login={login} onDone={onClose} />
      ) : (
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="Full name" error={errors.name}>{(id) => <Input id={id} value={f.name} onChange={set('name')} autoComplete="off" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {!official && <Field label="Email (sign-in)" error={errors.email}>{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} autoComplete="off" />}</Field>}
            <Field label="Mobile" error={errors.mobile}>{(id) => <Input id={id} inputMode="numeric" maxLength={10} value={f.mobile} onChange={set('mobile')} />}</Field>
          </div>
          <Field label="Designation" error={errors.designation}>{(id) => <Input id={id} value={f.designation} onChange={set('designation')} placeholder="District Supply Officer" />}</Field>
          <Field label="Scope" hint={f.districtId ? 'Sees dashboards, shops and complaints of this district only.' : 'Sees every district in the state.'}>
            {(id) => (
              <Select id={id} value={f.districtId} onChange={set('districtId')}>
                <option value="">Whole state</option>
                {districts.data?.map((d) => <option key={d.id} value={d.id}>{d.name} district</option>)}
              </Select>
            )}
          </Field>
          {error && <Alert tone="bad" title={error} />}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={busy}>{official ? 'Save changes' : 'Create official account'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
