'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { Alert, Button, Card, Field, Input, OtpInput } from '@srms/ui-kit';
import { mobileSchema, otpSchema } from '@srms/shared';
import { LangToggle, Logo } from '@/components/brand';
import { api, useErrorText } from '@/lib/beneficiary-api';
import { useI18n } from '@/lib/beneficiary-i18n';

/** FR-1 / login: mobile → OTP → home (registered) or registration form (new). */
export default function LoginPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [devOtp, setDevOtp] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    if (!mobileSchema.safeParse(mobile).success) return setError(t('invalid.mobile'));
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.post<{ devOtp?: string }>('/auth/otp', { mobile });
      setDevOtp(res.devOtp);
      setStep('otp');
      setResendIn(30);
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
      const res = await api.post<{ needsRegistration?: boolean }>('/auth/otp/verify', { mobile, otp });
      if (res.needsRegistration) {
        sessionStorage.setItem('srms-register', JSON.stringify({ mobile, otp }));
        router.push('/register');
      } else {
        location.replace('/'); // full load: drop any prefetch cached while logged out
      }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <div className="flex items-center justify-between">
        <Logo />
        <LangToggle />
      </div>

      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-3xl font-bold tracking-tight">{t('login.title')}</h1>
        <p className="mt-2 text-ink-2">{t('login.subtitle')}</p>

        <Card className="mt-6">
          {step === 'mobile' ? (
            <form onSubmit={sendOtp} className="space-y-5" noValidate>
              <Field label={t('login.mobile')} hint={t('login.mobileHint')} error={error}>
                {(id, describedBy) => (
                  <div className="flex items-stretch gap-2">
                    <span className="flex items-center rounded-xl border border-line bg-surface-2 px-3 font-semibold text-ink-2">+91</span>
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={Boolean(error)}
                      inputMode="numeric"
                      autoComplete="tel-national"
                      maxLength={10}
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                      className="text-lg tracking-wider"
                      autoFocus
                    />
                  </div>
                )}
              </Field>
              <Button type="submit" size="lg" block loading={busy}>
                {t('login.sendOtp')}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-5" noValidate>
              <p className="text-ink-2">{t('login.otpSentTo', { mobile })}</p>
              {devOtp && <Alert tone="accent" title={t('demo.otp', { otp: devOtp })} />}
              <Field label={t('login.otp')} error={error}>
                {(id, describedBy) => (
                  <OtpInput ref={otpRef} id={id} aria-describedby={describedBy} aria-invalid={Boolean(error)} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
                )}
              </Field>
              <Button type="submit" size="lg" block loading={busy}>
                {t('login.verify')}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="font-semibold text-brand" onClick={() => { setStep('mobile'); setOtp(''); setError(undefined); }}>
                  {t('login.changeNumber')}
                </button>
                {resendIn > 0 ? (
                  <span className="text-ink-3">{t('login.resendIn', { s: resendIn })}</span>
                ) : (
                  <button type="button" className="font-semibold text-brand" onClick={() => sendOtp()}>
                    {t('login.resend')}
                  </button>
                )}
              </div>
            </form>
          )}
        </Card>

        <p className="mt-6 flex items-center gap-2 text-sm text-ink-3">
          <ShieldCheck className="size-4 shrink-0" aria-hidden /> {t('login.secure')}
        </p>
      </div>
    </main>
  );
}
