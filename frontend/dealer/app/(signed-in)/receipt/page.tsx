'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Alert, Button, Loading } from '@srms/ui-kit';
import { ReceiptCard } from '@/components/receipt-card';
import { api, useErrorText } from '@/lib/dealer-api';
import { useI18n } from '@/lib/dealer-i18n';
import type { Receipt } from '@/lib/dealer-types';

/** /receipt?id=… — a plain route (no [id] folder) so the service worker can keep it for offline reloads. */
function ReceiptView() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const id = useSearchParams().get('id');
  const r = api.useGet<Receipt>(id ? `/dealer/distributions/${encodeURIComponent(id)}` : null);
  return (
    <div className="space-y-4">
      <Link href="/history" className="no-print inline-flex items-center gap-1.5 font-semibold text-brand"><ArrowLeft className="size-4" aria-hidden />{t('common.back')}</Link>
      {!r.data ? (
        r.error ? <Alert tone={r.error.status === 0 ? 'warn' : 'bad'} title={r.error.status === 0 ? t('common.notSaved') : errorText(r.error)} /> : <Loading label={t('common.loading')} />
      ) : (
        <>
          <ReceiptCard r={r.data} />
          <Button variant="secondary" className="no-print" onClick={() => window.print()}>{t('common.print')}</Button>
        </>
      )}
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense>
      <ReceiptView />
    </Suspense>
  );
}
