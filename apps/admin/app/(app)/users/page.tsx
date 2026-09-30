'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Alert, Badge, Button, Card, Empty, Input, Loading, Modal, PageHeader, Pager, Select, fmtAgo, fmtDate } from '@srms/ui';
import { Credentials } from '@/components/credentials';
import { api, useUser } from '@/lib/client';
import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE, type AccountStatus, type Login, type Paged, type UserRow } from '@/lib/types';

const EFFECT: Record<string, string> = {
  DEALER: 'The dealer is signed out at once and cannot issue ration at any of their shops.',
  BENEFICIARY: 'The beneficiary is signed out and cannot collect ration until reactivated.',
  OFFICIAL: 'The official is signed out at once and cannot sign in.',
  ADMIN: 'The administrator is signed out at once and cannot sign in.',
};

function Users() {
  const me = useUser();
  const params = useSearchParams();
  const [role, setRole] = useState(params.get('role') ?? '');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<{ user: UserRow; kind: 'status' | 'reset' } | null>(null);
  const query = new URLSearchParams({ page: String(page), ...(role ? { role } : {}), ...(q ? { q } : {}) });
  const res = api.useGet<Paged<UserRow>>(`/admin/users?${query}`);

  return (
    <>
      <PageHeader title="All users" subtitle="Every account in the system. Suspend access or reset a staff password." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Role</span>
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="w-44">
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </label>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-ink-3">Name, email or mobile</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" type="search" />
          </label>
          <Button type="submit" variant="secondary" aria-label="Search"><Search className="size-4" /></Button>
        </form>
      </div>

      <Card flush>
        {!res.data ? (
          <Loading />
        ) : res.data.items.length === 0 ? (
          <Empty title="No users match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Role</th><th>Sign-in</th><th>Status</th><th>Last sign-in</th><th>Created</th><th /></tr></thead>
              <tbody>
                {res.data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="font-semibold">{u.fullName}{u.id === me.id && <span className="ml-2 text-xs font-normal text-ink-3">(you)</span>}</td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className="text-sm">{u.email ?? (u.mobile ? <span className="text-ink-3">OTP to <span className="font-mono">******{u.mobile.slice(-4)}</span></span> : '—')}</td>
                    <td><Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge></td>
                    <td className="whitespace-nowrap text-ink-3">{u.lastLoginAt ? fmtAgo(u.lastLoginAt) : 'Never'}</td>
                    <td className="whitespace-nowrap text-ink-3">{fmtDate(u.createdAt)}</td>
                    <td className="whitespace-nowrap">
                      {u.id !== me.id && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setActing({ user: u, kind: 'status' })}>{u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</Button>
                          {u.role !== 'BENEFICIARY' && <Button size="sm" variant="ghost" onClick={() => setActing({ user: u, kind: 'reset' })}>Reset password</Button>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {res.data && <Pager page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} onPage={setPage} />}
      {acting?.kind === 'status' && <StatusModal user={acting.user} onClose={() => setActing(null)} onSaved={res.reload} />}
      {acting?.kind === 'reset' && <ResetModal user={acting.user} onClose={() => setActing(null)} />}
    </>
  );
}

function StatusModal({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<AccountStatus>(user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${user.id}/status`, { status });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`${user.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'} ${user.fullName}`}>
      <div className="space-y-4">
        {user.status === 'ACTIVE' ? (
          <>
            <Select value={status} onChange={(e) => setStatus(e.target.value as AccountStatus)} aria-label="New status">
              <option value="SUSPENDED">Suspend (temporary, e.g. under inquiry)</option>
              <option value="INACTIVE">Deactivate (left the scheme)</option>
            </Select>
            <p className="text-sm text-ink-2">{EFFECT[user.role]} The change is written to the audit log.</p>
          </>
        ) : (
          <p className="text-sm text-ink-2">{user.fullName} can sign in again straight away.</p>
        )}
        {error && <Alert tone="bad" title={error} />}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" variant={status === 'ACTIVE' ? 'primary' : 'danger'} loading={busy} onClick={save}>
            {status === 'ACTIVE' ? 'Reactivate' : status === 'SUSPENDED' ? 'Suspend account' : 'Deactivate account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [login, setLogin] = useState<Login | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    try {
      setLogin(await api.post<Login>(`/admin/users/${user.id}/reset-password`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Reset password — ${user.fullName}`}>
      {login ? (
        <Credentials login={login} onDone={onClose} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">A new temporary password is generated and shown once. Their current password stops working and they are signed out everywhere.</p>
          {error && <Alert tone="bad" title={error} />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" variant="danger" loading={busy} onClick={reset}>Reset password</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  return (
    <Suspense>
      <Users />
    </Suspense>
  );
}
