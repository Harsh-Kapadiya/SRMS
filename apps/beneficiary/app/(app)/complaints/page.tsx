'use client';
import Link from 'next/link';
import { ChevronRight, MessageSquareWarning, Plus } from 'lucide-react';
import { Badge, Button, Card, Empty, Loading, PageHeader, fmtDate } from '@srms/ui';
import { api } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { STATUS_TONE, type ComplaintRow } from '@/lib/types';

export default function ComplaintsPage() {
  const { t, lang } = useI18n();
  const res = api.useGet<ComplaintRow[]>('/me/complaints');
  const newButton = (
    <Link href="/complaints/new"><Button><Plus className="size-4" aria-hidden />{t('complaints.new')}</Button></Link>
  );
  if (!res.data) return <Loading label={t('common.loading')} />;
  return (
    <>
      <PageHeader title={t('complaints.title')} action={res.data.length ? newButton : undefined} />
      {!res.data.length ? (
        <Card>
          <Empty icon={<MessageSquareWarning className="size-10" />} title={t('complaints.empty')}>{t('complaints.emptyBody')}</Empty>
          <div className="flex justify-center pb-4">{newButton}</div>
        </Card>
      ) : (
        <Card flush>
          <ul className="divide-y divide-line">
            {res.data.map((c) => (
              <li key={c.id}>
                <Link href={`/complaints/${c.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-surface-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t(`cat.${c.category}` as 'cat.OTHER')}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</Badge>
                    </div>
                    <p className="truncate text-sm text-ink-2">{c.description}</p>
                    <p className="text-xs text-ink-3">{c.ticketNo} · {fmtDate(c.createdAt, lang)}</p>
                  </div>
                  <ChevronRight className="size-5 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
