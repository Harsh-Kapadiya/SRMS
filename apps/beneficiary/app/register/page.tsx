'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Card, Field, Input, Select, cx } from '@srms/ui';
import { registerSchema } from '@srms/shared';
import { LangToggle, Logo } from '@/components/brand';
import { api, useErrorText, useFieldErrors } from '@/lib/client';
import { useI18n, type TKey } from '@/lib/i18n';
import type { District, ShopOption } from '@/lib/types';

const RELATIONS = ['Spouse', 'Son', 'Daughter', 'Mother', 'Father', 'Other'] as const;
const STEP_FIELDS = [
  { name: true, guardianName: true, gender: true, dateOfBirth: true, aadhaar: true },
  { address: true, pincode: true, districtId: true, homeShopId: true, cardType: true },
  { family: true },
] as const;

type Form = {
  name: string; guardianName: string; gender: string; dateOfBirth: string; aadhaar: string;
  address: string; pincode: string; districtId: string; homeShopId: string; cardType: 'PHH' | 'AAY';
  family: { name: string; relation: string }[];
};

/** FR-1 beneficiary registration (after the mobile OTP from /login). */
export default function RegisterPage() {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const fieldErrors = useFieldErrors();
  const [auth, setAuth] = useState<{ mobile: string; otp: string } | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Form>({
    name: '', guardianName: '', gender: '', dateOfBirth: '', aadhaar: '',
    address: '', pincode: '', districtId: '', homeShopId: '', cardType: 'PHH', family: [],
  });

  useEffect(() => {
    try {
      setAuth(JSON.parse(sessionStorage.getItem('srms-register') ?? 'null'));
    } catch {
      setAuth(null);
    }
  }, []);

  const districts = api.useGet<District[]>('/public/districts');
  const shops = api.useGet<ShopOption[]>(f.districtId ? `/public/shops?districtId=${f.districtId}` : null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const payload = () => ({
    ...auth,
    name: f.name,
    guardianName: f.guardianName || undefined,
    gender: f.gender || undefined,
    dateOfBirth: f.dateOfBirth || undefined,
    aadhaar: f.aadhaar,
    address: f.address,
    pincode: f.pincode || undefined,
    districtId: f.districtId ? Number(f.districtId) : undefined,
    homeShopId: f.homeShopId || undefined,
    cardType: f.cardType,
    preferredLanguage: lang,
    family: f.family.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), relation: m.relation })),
  });

  function next(e: FormEvent) {
    e.preventDefault();
    const check = registerSchema.pick(STEP_FIELDS[step]!).safeParse(payload());
    if (!check.success) return setErrors(fieldErrors(check.error));
    setErrors({});
    if (step < 2) return setStep(step + 1);
    void submit();
  }

  async function submit() {
    const check = registerSchema.safeParse(payload());
    if (!check.success) return setErrors(fieldErrors(check.error));
    setBusy(true);
    setSubmitError(undefined);
    try {
      await api.post('/auth/register', check.data);
      sessionStorage.removeItem('srms-register');
      location.replace('/verify');
    } catch (err) {
      setSubmitError(errorText(err));
      setBusy(false);
    }
  }

  if (auth === undefined) return null;
  if (auth === null) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <Alert tone="warn" title={t('register.noOtp')} action={<Link className="font-semibold underline" href="/login">{t('login.sendOtp')}</Link>} />
      </main>
    );
  }

  const stepTitles: TKey[] = ['register.s1', 'register.s2', 'register.s3'];
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <div className="flex items-center justify-between">
        <Logo compact />
        <LangToggle />
      </div>

      <h1 className="mt-6 text-2xl font-bold">{t('register.title')}</h1>
      <ol className="mt-4 flex gap-2" aria-label={t('register.step', { n: step + 1 })}>
        {stepTitles.map((k, i) => (
          <li key={k} className="flex-1">
            <div className={cx('h-1.5 rounded-full', i <= step ? 'bg-brand' : 'bg-surface-3')} />
            <p className={cx('mt-1.5 text-xs font-semibold', i === step ? 'text-brand' : 'text-ink-3')} aria-current={i === step ? 'step' : undefined}>
              {t(k)}
            </p>
          </li>
        ))}
      </ol>

      <form onSubmit={next} noValidate>
        <Card className="mt-5 space-y-5">
          {step === 0 && (
            <>
              <Field label={t('field.name')} error={errors.name}>
                {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.name} autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />}
              </Field>
              <Field label={<>{t('field.guardian')} <span className="font-normal text-ink-3">({t('common.optional')})</span></>} error={errors.guardianName}>
                {(id, d) => <Input id={id} aria-describedby={d} value={f.guardianName} onChange={(e) => set('guardianName', e.target.value)} />}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('field.gender')}>
                  {(id) => (
                    <Select id={id} value={f.gender} onChange={(e) => set('gender', e.target.value)}>
                      <option value="">{t('common.choose')}</option>
                      {(['FEMALE', 'MALE', 'OTHER'] as const).map((g) => <option key={g} value={g}>{t(`gender.${g}`)}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label={t('field.dob')} error={errors.dateOfBirth}>
                  {(id) => <Input id={id} type="date" max={new Date().toISOString().slice(0, 10)} value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />}
                </Field>
              </div>
              <Field label={t('field.aadhaar')} hint={t('field.aadhaarHint')} error={errors.aadhaar}>
                {(id, d) => (
                  <Input
                    id={id}
                    aria-describedby={d}
                    aria-invalid={!!errors.aadhaar}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={14}
                    placeholder="XXXX XXXX XXXX"
                    className="font-mono text-lg tracking-wider"
                    value={f.aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ')}
                    onChange={(e) => set('aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  />
                )}
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <Field label={t('field.address')} error={errors.address}>
                {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.address} autoComplete="street-address" value={f.address} onChange={(e) => set('address', e.target.value)} autoFocus />}
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('field.pincode')} error={errors.pincode}>
                  {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.pincode} inputMode="numeric" maxLength={6} autoComplete="postal-code" value={f.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} />}
                </Field>
                <Field label={t('field.district')} error={errors.districtId}>
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} aria-invalid={!!errors.districtId} value={f.districtId} onChange={(e) => setF((p) => ({ ...p, districtId: e.target.value, homeShopId: '' }))}>
                      <option value="">{t('common.choose')}</option>
                      {districts.data?.map((d) => <option key={d.id} value={d.id}>{lang === 'hi' && d.nameHi ? d.nameHi : d.name}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
              {f.districtId && (
                <Field label={t('field.shop')} hint={shops.data?.length === 0 ? t('field.noShops') : t('field.shopHint')}>
                  {(id, d) => (
                    <Select id={id} aria-describedby={d} value={f.homeShopId} onChange={(e) => set('homeShopId', e.target.value)} disabled={!shops.data?.length}>
                      <option value="">{t('common.choose')}</option>
                      {shops.data?.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.address}</option>)}
                    </Select>
                  )}
                </Field>
              )}
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-ink-2">{t('field.cardType')}</legend>
                {(['PHH', 'AAY'] as const).map((c) => (
                  <label key={c} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border p-3.5', f.cardType === c ? 'border-brand bg-brand-soft' : 'border-line')}>
                    <input type="radio" name="cardType" value={c} checked={f.cardType === c} onChange={() => set('cardType', c)} className="mt-1 size-4 accent-[var(--brand)]" />
                    <span>
                      <span className="block font-semibold">{t(`card.${c}`)}</span>
                      <span className="block text-sm text-ink-3">{t(`card.${c}.desc`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-ink-2">{t('family.intro')}</p>
              <div className="flex items-center gap-3 rounded-xl bg-brand-soft px-3.5 py-3 text-brand-strong">
                <Check className="size-5" aria-hidden />
                <span className="font-semibold">{f.name}</span>
                <span className="text-sm">({t('relation.Self')})</span>
              </div>
              {f.family.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-3">
                  <Input aria-label={`${t('family.memberName')} ${i + 2}`} placeholder={t('family.memberName')} value={m.name} onChange={(e) => set('family', f.family.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Button type="button" variant="ghost" size="sm" aria-label={t('family.remove')} onClick={() => set('family', f.family.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                  <Select aria-label={t('family.relation')} value={m.relation} onChange={(e) => set('family', f.family.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)))}>
                    {RELATIONS.map((r) => <option key={r} value={r}>{t(`relation.${r}`)}</option>)}
                  </Select>
                </div>
              ))}
              {errors.family && <p className="text-sm text-bad">{errors.family}</p>}
              <Button type="button" variant="secondary" block onClick={() => set('family', [...f.family, { name: '', relation: 'Son' }])} disabled={f.family.length >= 19}>
                <Plus className="size-4" aria-hidden /> {t('family.add')}
              </Button>
              <p className="text-center text-sm font-semibold text-ink-2">{t('family.size', { n: 1 + f.family.filter((m) => m.name.trim()).length })}</p>
            </>
          )}

          {submitError && <Alert tone="bad" title={submitError} />}

          <div className="flex gap-3 pt-1">
            {step > 0 && (
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="size-4" aria-hidden /> {t('common.back')}
              </Button>
            )}
            <Button type="submit" size="lg" className="flex-1" loading={busy}>
              {step < 2 ? t('common.next') : t('register.submit')}
            </Button>
          </div>
        </Card>
      </form>
      <p className="mt-3 text-center text-sm text-ink-3">{t('register.step', { n: step + 1 })}</p>
    </main>
  );
}
