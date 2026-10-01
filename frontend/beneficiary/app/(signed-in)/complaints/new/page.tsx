'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Ban, CircleDollarSign, Frown, Paperclip, Scale, Store, UserX, Wheat, X } from 'lucide-react';
import { Alert, Button, Card, Field, PageHeader, Textarea, cx } from '@srms/ui-kit';
import { COMPLAINT_CATEGORIES, RULES, complaintCreateSchema, type ComplaintCategoryName } from '@srms/shared';
import { api, useErrorText, useFieldErrors } from '@/lib/beneficiary-api';
import { useI18n } from '@/lib/beneficiary-i18n';

const ICONS: Record<ComplaintCategoryName, typeof Wheat> = {
  SHORT_WEIGHT: Scale, POOR_QUALITY: Wheat, DENIED_RATION: Ban, OVERCHARGING: CircleDollarSign,
  SHOP_CLOSED: Store, DEALER_BEHAVIOUR: UserX, OTHER: Frown,
};
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function NewComplaint() {
  const { t } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const fieldErrors = useFieldErrors();
  const receipt = useSearchParams().get('receipt');
  const [category, setCategory] = useState<ComplaintCategoryName | null>(receipt ? 'SHORT_WEIGHT' : null);
  const [description, setDescription] = useState(receipt ? `Receipt ${receipt}: ` : '');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!FILE_TYPES.includes(f.type)) return setErrors({ file: t('complaint.badType') });
    if (f.size > RULES.MAX_ATTACHMENT_BYTES) return setErrors({ file: t('complaint.tooBig') });
    setErrors({});
    setFile(f);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = complaintCreateSchema.safeParse({ category: category ?? undefined, description });
    if (!check.success) return setErrors(fieldErrors(check.error));
    setBusy(true);
    try {
      const attachmentId = file ? (await api.upload<{ id: string }>('/me/attachments', file)).id : undefined;
      const c = await api.post<{ id: string }>('/me/complaints', { ...check.data, attachmentId });
      router.replace(`/complaints/${c.id}`);
    } catch (err) {
      setErrors({ submit: errorText(err) });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title={t('complaints.new')} />
      <Card className="space-y-6">
        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink-2">{t('complaint.category')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {COMPLAINT_CATEGORIES.map((c) => {
              const Icon = ICONS[c];
              return (
                <label key={c} className={cx('flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center text-sm font-semibold', category === c ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line hover:bg-surface-2')}>
                  <input type="radio" name="category" value={c} className="sr-only" checked={category === c} onChange={() => setCategory(c)} />
                  <Icon className="size-6" aria-hidden />
                  {t(`cat.${c}`)}
                </label>
              );
            })}
          </div>
          {errors.category && <p className="mt-2 text-sm text-bad" role="alert">{t('invalid.required')}</p>}
        </fieldset>

        <Field label={t('complaint.description')} hint={t('complaint.descriptionHint')} error={errors.description}>
          {(id, d) => <Textarea id={id} aria-describedby={d} aria-invalid={!!errors.description} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />}
        </Field>

        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-ink-2">{t('complaint.photo')} <span className="font-normal text-ink-3">({t('common.optional')})</span></p>
          {file ? (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
              <Paperclip className="size-4 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} aria-label={t('family.remove')} className="text-ink-3 hover:text-bad"><X className="size-4" /></button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-5 text-sm font-semibold text-brand hover:bg-brand-soft">
              <Paperclip className="size-4" aria-hidden />
              {t('complaint.photoHint')}
              <input type="file" accept={FILE_TYPES.join(',')} className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
          )}
          {errors.file && <p className="text-sm text-bad" role="alert">{errors.file}</p>}
        </div>

        {errors.submit && <Alert tone="bad" title={errors.submit} />}
        <Button type="submit" size="lg" block loading={busy}>{t('complaint.submit')}</Button>
      </Card>
    </form>
  );
}

export default function NewComplaintPage() {
  return (
    <Suspense>
      <NewComplaint />
    </Suspense>
  );
}
