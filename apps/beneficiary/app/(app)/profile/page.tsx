'use client';
import { useState, type ReactNode } from 'react';
import { LogOut, Store } from 'lucide-react';
import { Alert, Badge, Button, Card, Field, PageHeader, Select, cx, fmtDate } from '@srms/ui';
import { api, useErrorText, useMe } from '@/lib/client';
import { useI18n, type TKey } from '@/lib/i18n';
import type { ShopOption } from '@/lib/types';

export default function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const errorText = useErrorText();
  const { me, reload } = useMe();
  const b = me.beneficiary!;
  const [shopId, setShopId] = useState(b.homeShopId ?? '');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  const shops = api.useGet<ShopOption[]>(`/public/shops?districtId=${b.districtId}`);

  async function save(body: object) {
    setMsg(undefined);
    try {
      await api.patch('/me', body);
      reload();
      setMsg({ tone: 'ok', text: t('profile.saved') });
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err) });
    }
  }

  async function logout() {
    await api.post('/auth/logout').catch(() => undefined);
    location.replace('/login');
  }

  const rows: [TKey, ReactNode][] = [
    ['profile.cardNo', <span key="c" className="font-mono">{b.rationCardNo ?? '—'}</span>],
    ['profile.regNo', <span key="r" className="font-mono">{b.registrationNo}</span>],
    ['profile.category', t(`card.${b.cardType}`)],
    ['profile.aadhaar', <span key="a" className="font-mono">{b.aadhaarMasked}</span>],
    ['profile.mobile', `+91 ${b.mobile}`],
    ['profile.address', b.address],
    ['profile.district', lang === 'hi' && b.district.nameHi ? b.district.nameHi : b.district.name],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('profile.title')}
        subtitle={fmtDate(b.registrationDate, lang)}
        action={<Badge tone={b.verificationStatus === 'VERIFIED' ? 'ok' : b.verificationStatus === 'PENDING' ? 'warn' : 'bad'}>{t(`vstatus.${b.verificationStatus}`)}</Badge>}
      />

      <Card>
        <h2 className="text-lg font-bold">{b.name}</h2>
        {b.guardianName && <p className="text-sm text-ink-3">{b.guardianName}</p>}
        <dl className="mt-4 divide-y divide-line text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-3">{t(k)}</dt>
              <dd className="text-right font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t('profile.family')} <span className="text-base font-semibold text-ink-3">({b.familySize})</span></h2>
        <ul className="space-y-2">
          {b.familyMembers.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5">
              <span className="font-semibold">{m.name}</span>
              <span className="text-sm text-ink-3">{m.isHead ? t('profile.head') : t(`relation.${m.relation}` as TKey) === `relation.${m.relation}` ? m.relation : t(`relation.${m.relation}` as TKey)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Store className="size-5 text-ink-3" aria-hidden />{t('profile.shop')}</h2>
        {b.homeShop && <p className="text-ink-2">{b.homeShop.name}<span className="block text-sm text-ink-3">{b.homeShop.address}</span></p>}
        <Field label={t('profile.changeShop')}>
          {(id) => (
            <div className="flex gap-2">
              <Select id={id} value={shopId} onChange={(e) => setShopId(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {shops.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Button variant="secondary" disabled={!shopId || shopId === b.homeShopId} onClick={() => save({ homeShopId: shopId })}>{t('common.save')}</Button>
            </div>
          )}
        </Field>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">{t('profile.language')}</h2>
        <div className="grid grid-cols-2 gap-2">
          {(['hi', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => { setLang(l); void save({ preferredLanguage: l }); }}
              className={cx('min-h-12 rounded-xl border font-semibold', lang === l ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line hover:bg-surface-2')}
            >
              {l === 'hi' ? 'हिंदी' : 'English'}
            </button>
          ))}
        </div>
        <p className="text-sm text-ink-3">SMS: {b.preferredLanguage === 'hi' ? 'हिंदी' : 'English'}</p>
      </Card>

      {msg && <Alert tone={msg.tone} title={msg.text} />}

      <Button variant="secondary" block size="lg" onClick={logout}><LogOut className="size-5" aria-hidden />{t('profile.logout')}</Button>
    </div>
  );
}
