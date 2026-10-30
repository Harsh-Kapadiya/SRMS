/**
 * FR-7 SMS notifications. Business transactions write rows to `notifications`
 * (the outbox, often via DB triggers); this worker delivers them through the
 * configured gateway and records delivery status (LLD Module 6).
 */
import { sql } from 'drizzle-orm';
import { istMonthKey } from '@srms/shared';
import { db } from './db';
import { env } from './env';

type Sender = (mobile: string, text: string) => Promise<string | undefined>;

const senders: Record<typeof env.SMS_PROVIDER, Sender> = {
  // Development / demo: print instead of sending.
  log: async (mobile, text) => {
    console.log(JSON.stringify({ level: 'info', msg: 'sms', to: `******${mobile.slice(-4)}`, text }));
    return undefined;
  },
  twilio: async (mobile, text) => {
    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: `+91${mobile}`, From: env.TWILIO_FROM ?? '', Body: text }),
    });
    const body = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) throw new Error(body.message ?? `Twilio HTTP ${res.status}`);
    return body.sid;
  },
  fast2sms: async (mobile, text) => {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: env.FAST2SMS_API_KEY ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ route: 'q', message: text, numbers: mobile }),
    });
    const body = (await res.json()) as { return?: boolean; request_id?: string; message?: string | string[] };
    if (!res.ok || !body.return) throw new Error(String(body.message ?? `Fast2SMS HTTP ${res.status}`));
    return body.request_id;
  },
};

const MAX_ATTEMPTS = 5;

/** Deliver one batch of queued notifications. Exported for tests. */
export async function deliverQueued(batch = 25): Promise<number> {
  const send = senders[env.SMS_PROVIDER];
  return db.transaction(async (tx) => {
    const enabled = await tx.execute<{ on: boolean }>(
      sql`select coalesce((select (value #>> '{}')::boolean from settings where key = 'sms_enabled'), true) as on`,
    );
    // ponytail: SKIP LOCKED lets several API instances share the queue; HTTP
    // calls run inside the lock, fine for small batches.
    const { rows } = await tx.execute<{ id: string; channel: string; mobile: string | null; message: string; event_type: string; attempts: number }>(sql`
      select notification_id as id, channel, mobile, message, event_type, attempts
      from notifications where delivery_status = 'QUEUED'
      order by created_at limit ${batch} for update skip locked`);

    for (const n of rows) {
      // OTP texts are secrets: never keep them after the send attempt.
      const redact = n.event_type === 'OTP' ? sql`, message = 'OTP (redacted after sending)'` : sql``;
      if (n.channel === 'IN_APP' || !n.mobile) {
        await tx.execute(sql`update notifications set delivery_status = 'DELIVERED', sent_at = now(), delivered_at = now() where notification_id = ${n.id}`);
        continue;
      }
      if (!enabled.rows[0]!.on) {
        await tx.execute(sql`update notifications set delivery_status = 'FAILED', last_error = 'SMS disabled in settings' ${redact} where notification_id = ${n.id}`);
        continue;
      }
      try {
        const providerId = await send(n.mobile, n.message);
        await tx.execute(sql`
          update notifications set delivery_status = 'SENT', provider = ${env.SMS_PROVIDER}, provider_message_id = ${providerId ?? null},
                 attempts = attempts + 1, sent_at = now(), last_error = null ${redact}
          where notification_id = ${n.id}`);
      } catch (err) {
        const failed = n.attempts + 1 >= MAX_ATTEMPTS;
        await tx.execute(sql`
          update notifications set attempts = attempts + 1, last_error = ${String((err as Error).message).slice(0, 500)},
                 delivery_status = ${failed ? 'FAILED' : 'QUEUED'} ${failed ? redact : sql``}
          where notification_id = ${n.id}`);
      }
    }
    return rows.length;
  });
}

/** Start the background loop: deliver SMS every few seconds, top up monthly quotas hourly. */
export function startWorker(intervalMs = 4000): () => void {
  let busy = false;
  let lastQuotaRun = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      while ((await deliverQueued()) === 25);
      if (Date.now() - lastQuotaRun > 3_600_000) {
        // New month → everyone's entitlement appears without anyone doing anything.
        await db.execute(sql`select srms_generate_quotas(${istMonthKey()}::date)`);
        await db.execute(sql`delete from otp_challenges where expires_at < now() - interval '1 day'`);
        await db.execute(sql`delete from sessions where expires_at < now()`);
        lastQuotaRun = Date.now();
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'worker', err: String(err) }));
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => clearInterval(timer);
}
