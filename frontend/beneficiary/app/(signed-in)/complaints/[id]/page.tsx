'use client';
import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Paperclip } from 'lucide-react';
import { Alert, Badge, Button, Card, Field, Loading, Textarea, cx, fmtDate, fmtDateTime } from '@srms/ui-kit';
import { api, useErrorText } from '@/lib/beneficiary-api';
import { useI18n } from '@/lib/beneficiary-i18n';
import { STATUS_TONE, type ComplaintDetail } from '@/lib/beneficiary-types';

export default function ComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const c = api.useGet<ComplaintDetail>(`/me/complaints/${id}`);
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function reopen(e: FormEvent) {
    e.preventDefault();
    if (note.trim().length < 5) return setError(t('invalid.description'));
    setBusy(true);
    try {
      await api.post(`/me/complaints/${id}/reopen`, { note });
      setReopening(false);
      setNote('');
      c.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!c.data) return c.error ? <Alert tone="bad" title={c.error.message} /> : <Loading label={t('common.loading')} />;
  const d = c.data;
  const closed = d.status === 'RESOLVED' || d.status === 'REJECTED';

  return (
    <div className="space-y-4">
      <Link href="/complaints" className="inline-flex items-center gap-1.5 font-semibold text-brand"><ArrowLeft className="size-4" aria-hidden />{t('common.back')}</Link>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{t(`cat.${d.category}` as 'cat.OTHER')}</h1>
          <Badge tone={STATUS_TONE[d.status]}>{t(`status.${d.status}`)}</Badge>
        </div>
        <p className="text-sm text-ink-3">
          {t('complaint.ticket', { no: d.ticketNo })} · {t('complaint.filed', { date: fmtDate(d.createdAt, lang) })}
          {d.shop && <> · {t('complaint.shop')}: {d.shop.name}</>}
        </p>
        <p className="whitespace-pre-wrap">{d.description}</p>
        {d.attachment && (
          <p className="flex items-center gap-2 text-sm text-ink-2"><Paperclip className="size-4" aria-hidden />{t('complaint.attachment')}: {d.attachment.fileName}</p>
        )}
        {d.assignedOfficial && <p className="text-sm text-ink-3">{t('complaint.assigned', { name: `${d.assignedOfficial.name}, ${d.assignedOfficial.designation}` })}</p>}
      </Card>

      {closed && d.resolution && (
        <Alert tone={d.status === 'RESOLVED' ? 'ok' : 'neutral'} title={t('complaint.resolution')}>{d.resolution}</Alert>
      )}

      <Card>
        <h2 className="mb-4 font-bold">{t('complaint.timeline')}</h2>
        <ol className="relative space-y-5 border-l-2 border-line pl-5">
          {d.events.map((e) => (
            <li key={e.id} className="relative">
              <span className={cx('absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-surface', e.toStatus === 'RESOLVED' ? 'bg-ok' : e.toStatus === 'IN_PROGRESS' ? 'bg-info' : 'bg-accent')} aria-hidden />
              <p className="font-semibold">{t(`status.${e.toStatus}`)}</p>
              {e.note && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-2">{e.note}</p>}
              <p className="mt-0.5 text-xs text-ink-3">{fmtDateTime(e.createdAt, lang)}{e.actor ? ` · ${e.actor.fullName}` : ''}</p>
            </li>
          ))}
        </ol>
      </Card>

      {closed && (
        reopening ? (
          <Card>
            <form onSubmit={reopen} className="space-y-4" noValidate>
              <Field label={t('complaint.reopenNote')} error={error}>
                {(fid, desc) => <Textarea id={fid} aria-describedby={desc} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />}
              </Field>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={() => setReopening(false)}>{t('common.cancel')}</Button>
                <Button type="submit" className="flex-1" loading={busy}>{t('complaint.reopenSubmit')}</Button>
              </div>
            </form>
          </Card>
        ) : (
          <Button variant="secondary" block onClick={() => setReopening(true)}>{t('complaint.reopen')}</Button>
        )
      )}
    </div>
  );
}
