'use client';
import { LangToggle, StaffLogin } from '@srms/ui-kit';
import { api, useErrorText } from '@/lib/dealer-api';
import { useI18n } from '@/lib/dealer-i18n';

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const errorText = useErrorText();
  return (
    <StaffLogin
      api={api}
      title={t('login.title')}
      subtitle={t('login.subtitle')}
      errorText={errorText}
      corner={<LangToggle lang={lang} setLang={setLang} />}
      text={{
        brand: t('login.brand'), footer: t('login.footer'), signIn: t('login.signIn'), signInHint: t('login.hint'),
        email: t('login.email'), password: t('login.password'), demoAccounts: t('login.demo'),
      }}
      demo={DEMO ? [{ label: t('login.title'), email: 'dealer@srms.demo', password: 'Dealer@12345' }] : undefined}
    />
  );
}
