'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { settingsUpdateSchema } from '@srms/shared';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, fmtDateTime } from '@srms/ui-kit';
import { api, validate } from '@/lib/admin-api';
import type { Setting } from '@/lib/admin-types';

type Kind = 'number' | 'boolean' | 'text';
/** Order, label, input kind, unit and (for switches) what turning it off means. */
const FIELDS: { key: string; label: string; kind: Kind; unit?: string; offWarning?: string }[] = [
  { key: 'low_stock_pct', label: 'Low-stock alert threshold', kind: 'number', unit: '% of monthly quota' },
  { key: 'max_shops_per_dealer', label: 'Maximum shops per dealer', kind: 'number', unit: 'shops' },
  { key: 'require_pos_otp', label: 'Require beneficiary OTP at the shop', kind: 'boolean', offWarning: 'Dealers could issue ration without the beneficiary’s OTP. Turn off only during an Aadhaar/SMS outage.' },
  { key: 'otp_ttl_seconds', label: 'OTP validity', kind: 'number', unit: 'seconds' },
  { key: 'offline_max_hours', label: 'Offline transaction review window', kind: 'number', unit: 'hours' },
  { key: 'sms_enabled', label: 'Send SMS notifications', kind: 'boolean', offWarning: 'Beneficiaries will not get registration, ration-issued or complaint SMS. OTP login still needs SMS.' },
  { key: 'state_name', label: 'State', kind: 'text' },
];

export default function SettingsPage() {
  const res = api.useGet<Setting[]>('/admin/settings');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string }>();
  const [busy, setBusy] = useState(false);
  const byKey = Object.fromEntries((res.data ?? []).map((s) => [s.key, s]));

  useEffect(() => {
    if (res.data) setValues(Object.fromEntries(res.data.map((s) => [s.key, typeof s.value === 'boolean' ? s.value : String(s.value)])));
  }, [res.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    // Send only what changed, typed as the schema expects.
    const changed = Object.fromEntries(
      FIELDS.filter((f) => byKey[f.key] && String(values[f.key]) !== String(byKey[f.key]!.value)).map((f) => [
        f.key,
        f.kind === 'number' ? (String(values[f.key]).trim() === '' ? Number.NaN : Number(values[f.key])) : values[f.key],
      ]),
    );
    if (!Object.keys(changed).length) return setMsg({ tone: 'ok', text: 'Nothing changed.' });
    const v = validate(settingsUpdateSchema, changed);
    setErrors(v.errors ?? {});
    if (!v.data) return setMsg(undefined);
    setBusy(true);
    try {
      await api.patch('/admin/settings', v.data);
      setMsg({ tone: 'ok', text: `Saved ${Object.keys(changed).length} ${Object.keys(changed).length === 1 ? 'change' : 'changes'}. They apply immediately.` });
      res.reload();
    } catch (err) {
      setMsg({ tone: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!res.data) return res.error ? <Alert tone="bad" title={res.error.message} /> : <Loading />;
  const lastChange = res.data.reduce<Setting | null>((a, s) => (!a || s.updatedAt > a.updatedAt ? s : a), null);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle={lastChange ? `Rules the whole system follows · last changed ${fmtDateTime(lastChange.updatedAt)}` : undefined} />
      <Card>
        <form onSubmit={save} className="space-y-6" noValidate>
          {FIELDS.filter((f) => byKey[f.key]).map((f) => {
            const hint = byKey[f.key]!.description ?? undefined;
            if (f.kind === 'boolean') {
              const on = values[f.key] === true;
              return (
                <div key={f.key} className="space-y-2">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" role="switch" checked={on} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} className="mt-1 size-5 accent-[var(--brand)]" />
                    <span>
                      <span className="block font-semibold">{f.label}</span>
                      <span className="block text-sm text-ink-3">{hint}</span>
                    </span>
                  </label>
                  {!on && f.offWarning && <Alert tone="warn" title={f.offWarning} />}
                </div>
              );
            }
            return (
              <Field key={f.key} label={f.label} hint={hint} error={errors[f.key]}>
                {(id) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id} type={f.kind === 'number' ? 'number' : 'text'} inputMode={f.kind === 'number' ? 'numeric' : undefined}
                      value={String(values[f.key] ?? '')} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      className={f.kind === 'number' ? 'w-32' : 'w-64'}
                    />
                    {f.unit && <span className="text-sm text-ink-3">{f.unit}</span>}
                  </div>
                )}
              </Field>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy}>Save settings</Button>
            {msg && <span role="status" className={msg.tone === 'ok' ? 'text-sm font-semibold text-ok' : 'text-sm font-semibold text-bad'}>{msg.text}</span>}
          </div>
        </form>
      </Card>
    </div>
  );
}
