'use client';
import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BadgeCheck, Fingerprint } from 'lucide-react';
import { Alert, Button, Card, Field, OtpInput } from '@srms/ui-kit';
import { otpSchema } from '@srms/shared';
import { api, useErrorText, useMe } from '@/lib/beneficiary-api';
import { useI18n } from '@/lib/beneficiary-i18n';
import type { Me } from '@/lib/beneficiary-types';

/** FR-2 Aadhaar authentication (mock UIDAI OTP). */
export default function VerifyPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { me, reload } = useMe();
  const [sent, setSent] = useState<{ sentTo: string; devOtp?: string }>();
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(me.beneficiary?.verificationStatus === 'VERIFIED' ? me.beneficiary.rationCardNo : null);
  const otpRef = useRef<HTMLInputElement>(null);

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      setSent(await api.post('/me/aadhaar/otp'));
      setTimeout(() => otpRef.current?.focus(), 50);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!otpSchema.safeParse(otp).success) return setError(t('invalid.otp'));
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.post<{ user: Me }>('/me/aadhaar/verify', { otp });
      setDone(res.user.beneficiary?.rationCardNo ?? '');
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <Card className="mx-auto max-w-md space-y-4 text-center">
        <BadgeCheck className="mx-auto size-16 text-ok" aria-hidden />
        <h1 className="text-2xl font-bold">{t('verify.done')}</h1>
        {done && (
          <div>
            <p className="text-ink-3">{t('verify.cardNo')}</p>
            <p className="font-mono text-3xl font-bold tracking-wider">{done.replace(/(\d{4})(?=\d)/g, '$1 ')}</p>
          </div>
        )}
        <Link href="/"><Button size="lg" block>{t('verify.goHome')}</Button></Link>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-md space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand"><Fingerprint className="size-6" aria-hidden /></span>
        <h1 className="text-2xl font-bold">{t('verify.title')}</h1>
      </div>
      <p className="text-ink-2">{t('verify.intro')}</p>
      <p className="text-sm text-ink-3">{t('verify.demoNote')}</p>
      {!sent ? (
        <>
          {error && <Alert tone="bad" title={error} />}
          <Button size="lg" block loading={busy} onClick={send}>{t('verify.send')}</Button>
        </>
      ) : (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <p className="text-ink-2">{t('verify.sentTo', { to: sent.sentTo })}</p>
          {sent.devOtp && <Alert tone="accent" title={t('demo.otp', { otp: sent.devOtp })} />}
          <Field label={t('login.otp')} error={error}>
            {(id, d) => <OtpInput ref={otpRef} id={id} aria-describedby={d} aria-invalid={!!error} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          <Button type="submit" size="lg" block loading={busy}>{t('verify.verify')}</Button>
          <button type="button" className="w-full text-sm font-semibold text-brand" onClick={send} disabled={busy}>{t('login.resend')}</button>
        </form>
      )}
    </Card>
  );
}
