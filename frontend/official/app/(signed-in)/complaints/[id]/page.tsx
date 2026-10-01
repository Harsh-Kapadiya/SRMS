'use client';
import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Paperclip } from 'lucide-react';
import { Alert, Badge, Button, Card, Field, Loading, Textarea, cx, fmtDateTime } from '@srms/ui-kit';
import { api } from '@/lib/official-api';
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, type ComplaintDetail, type ComplaintStatus } from '@/lib/official-types';

/** Work a complaint: take it up, add notes, resolve or reject with a response to the beneficiary. */
export default function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const res = api.useGet<ComplaintDetail>(`/official/complaints/${id}`);
  const [action, setAction] = useState<ComplaintStatus | 'NOTE' | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 5) return setError('Please write at least a short note (5+ characters).');
    setBusy(true);
    setError(undefined);
    try {
      const body = action === 'NOTE' ? { note: text } : action === 'RESOLVED' || action === 'REJECTED' ? { status: action, resolution: text } : { status: action, note: text };
      await api.patch(`/official/complaints/${id}`, body);
      setAction(null);
      setText('');
      res.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openAttachment() {
    const win = window.open('about:blank', '_blank'); // open synchronously so popup blockers allow it
    const blob = await api.get<Blob>(`/official/complaints/${id}/attachment`);
    if (win) win.location.href = URL.createObjectURL(blob);
  }

  if (!res.data) return res.error ? <Alert tone="bad" title={res.error.message} /> : <Loading />;
  const c = res.data;
  const closed = c.status === 'RESOLVED' || c.status === 'REJECTED';
  const actions: { value: ComplaintStatus | 'NOTE'; label: string; variant: 'primary' | 'secondary' | 'danger' }[] = closed
    ? [{ value: 'OPEN', label: 'Reopen', variant: 'secondary' }, { value: 'NOTE', label: 'Add note', variant: 'secondary' }]
    : [
        ...(c.status === 'OPEN' ? [{ value: 'IN_PROGRESS' as const, label: 'Take up', variant: 'secondary' as const }] : []),
        { value: 'RESOLVED', label: 'Resolve', variant: 'primary' },
        { value: 'REJECTED', label: 'Reject', variant: 'danger' },
        { value: 'NOTE', label: 'Add note', variant: 'secondary' },
      ];
  const prompt: Record<string, string> = {
    RESOLVED: 'Resolution (sent to the beneficiary by SMS)',
    REJECTED: 'Reason for rejecting (sent to the beneficiary by SMS)',
    IN_PROGRESS: 'What will you do next?',
    OPEN: 'Why is this being reopened?',
    NOTE: 'Internal note',
  };

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/complaints" className="no-print inline-flex items-center gap-1.5 font-semibold text-brand"><ArrowLeft className="size-4" aria-hidden />All complaints</Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{CATEGORY_LABEL[c.category] ?? c.category}</h1>
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
        <span className="font-mono text-ink-3">{c.ticketNo}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="space-y-4">
          <p className="whitespace-pre-wrap text-lg">{c.description}</p>
          {c.attachment && (
            <Button variant="secondary" size="sm" onClick={openAttachment}>
              <Paperclip className="size-4" aria-hidden />{c.attachment.fileName} ({Math.ceil(c.attachment.sizeBytes / 1024)} KB)
            </Button>
          )}
          {closed && c.resolution && <Alert tone={c.status === 'RESOLVED' ? 'ok' : 'neutral'} title="Response sent to beneficiary">{c.resolution}</Alert>}
        </Card>
        <Card>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-ink-3">Beneficiary</dt><dd className="font-semibold">{c.beneficiary.name}</dd><dd className="text-ink-3">Card {c.beneficiary.rationCardNo ?? '—'} · {c.beneficiary.mobile}</dd></div>
            <div><dt className="text-ink-3">Shop</dt><dd className="font-semibold">{c.shop ? <Link href={`/shops/${c.shop.id}`} className="text-brand hover:underline">{c.shop.name}</Link> : '—'}</dd><dd className="text-ink-3">{c.shop?.shopCode}</dd></div>
            <div><dt className="text-ink-3">Dealer</dt><dd className="font-semibold">{c.dealer?.name ?? '—'}</dd><dd className="text-ink-3">{c.dealer?.licenseNo}</dd></div>
            <div><dt className="text-ink-3">Assigned to</dt><dd className="font-semibold">{c.assignedOfficial ? `${c.assignedOfficial.name}` : 'Unassigned'}</dd></div>
            <div><dt className="text-ink-3">Filed</dt><dd>{fmtDateTime(c.createdAt)}</dd></div>
          </dl>
        </Card>
      </div>

      <Card className="no-print">
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.value} variant={action === a.value ? 'primary' : a.variant} size="sm" onClick={() => { setAction(a.value); setError(undefined); }}>{a.label}</Button>
          ))}
        </div>
        {action && (
          <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
            <Field label={prompt[action]!} error={error}>
              {(fid, d) => <Textarea id={fid} aria-describedby={d} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} autoFocus />}
            </Field>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setAction(null)}>Cancel</Button>
              <Button type="submit" loading={busy} variant={action === 'REJECTED' ? 'danger' : 'primary'}>Save</Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 font-bold">History</h2>
        <ol className="relative space-y-5 border-l-2 border-line pl-5">
          {c.events.map((e) => (
            <li key={e.id} className="relative">
              <span className={cx('absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-surface', e.toStatus === 'RESOLVED' ? 'bg-ok' : e.toStatus === 'REJECTED' ? 'bg-ink-3' : e.toStatus === 'IN_PROGRESS' ? 'bg-info' : 'bg-accent')} aria-hidden />
              <p className="font-semibold">{e.fromStatus === e.toStatus ? 'Note' : STATUS_LABEL[e.toStatus]}</p>
              {e.note && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-2">{e.note}</p>}
              <p className="mt-0.5 text-xs text-ink-3">{fmtDateTime(e.createdAt)}{e.actor ? ` · ${e.actor.fullName}` : ''}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
