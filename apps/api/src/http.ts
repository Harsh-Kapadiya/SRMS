import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { ZodError, type ZodType } from 'zod';
import { parseDbError, type Actor } from '@srms/db';
import { APPS, type AppName, type RoleName } from '@srms/shared';
import { db } from './db';
import { isProd } from './env';

// ─── errors ───────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
  ) {
    super(message);
  }
}
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg, 'FORBIDDEN');

const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_unique: 'This email is already in use',
  users_role_mobile_key: 'This mobile number is already registered',
  beneficiaries_aadhaar_hash_unique: 'This Aadhaar number is already registered',
  dealers_license_id_unique: 'A dealer with this licence number already exists',
  shops_shop_code_unique: 'A shop with this code already exists',
  commodities_code_unique: 'A commodity with this code already exists',
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: err.issues[0]?.message ?? 'Invalid input',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const dbErr = parseDbError(err);
  if (dbErr) {
    const message = (dbErr.constraint && UNIQUE_MESSAGES[dbErr.constraint]) || dbErr.message;
    res.status(dbErr.status).json({ error: { code: dbErr.code, message } });
    return;
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'File is too large (max 1 MB)' } });
    return;
  }
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    return;
  }
  console.error(JSON.stringify({ level: 'error', path: req.path, err: String((err as Error)?.stack ?? err) }));
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}

/** Validate with a shared zod schema (a ZodError becomes a 400 in errorHandler). */
export const parse = <T>(schema: ZodType<T>, data: unknown): T => schema.parse(data);

// ─── sessions ─────────────────────────────────────────────────────────────────

export const APP_ROLE: Record<AppName, RoleName> = {
  beneficiary: 'BENEFICIARY',
  dealer: 'DEALER',
  official: 'OFFICIAL',
  admin: 'ADMIN',
};
const SESSION_HOURS: Record<AppName, number> = { beneficiary: 24 * 30, dealer: 12, official: 12, admin: 8 };
const cookieName = (app: AppName) => `srms_${app}`;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface AuthUser {
  id: string;
  role: RoleName;
  fullName: string;
  app: AppName;
  sessionId: string;
  beneficiaryId: string | null;
  dealerId: string | null;
  officialId: string | null;
  /** Officials: their district (null = state-level). */
  districtId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Every web app sends `X-SRMS-App: <app>`. Cookies are per app (so a dealer and
 * a beneficiary can be logged in side by side on localhost), and because a
 * cross-site form cannot set a custom header, this doubles as CSRF protection.
 */
export function appFromRequest(req: Request): AppName {
  const app = req.get('x-srms-app') as AppName | undefined;
  if (!app || !APPS.includes(app)) throw new HttpError(400, 'Missing or unknown X-SRMS-App header', 'BAD_APP');
  return app;
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export async function startSession(req: Request, res: Response, userId: string, app: AppName): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS[app] * 3_600_000);
  await db.execute(sql`
    insert into sessions (user_id, token_hash, app, expires_at, ip, user_agent)
    values (${userId}, ${sha256(token)}, ${app}, ${expiresAt}, ${req.ip ?? null}, ${req.get('user-agent')?.slice(0, 300) ?? null})`);
  await db.execute(sql`update users set last_login_at = now() where id = ${userId}`);
  res.cookie(cookieName(app), token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const app = appFromRequest(req);
  const token = readCookie(req, cookieName(app));
  if (token) await db.execute(sql`delete from sessions where token_hash = ${sha256(token)}`);
  res.clearCookie(cookieName(app), { path: '/' });
}

/** Resolve the session (if any) and attach req.user. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.get('x-srms-app')) return next();
  const app = appFromRequest(req);
  const token = readCookie(req, cookieName(app));
  if (!token) return next();
  const { rows } = await db.execute<{
    session_id: string; app: AppName; id: string; role: RoleName; full_name: string;
    beneficiary_id: string | null; dealer_id: string | null; official_id: string | null; district_id: number | null;
  }>(sql`
    select s.id as session_id, s.app, u.id, u.role, u.full_name,
           b.beneficiary_id, d.dealer_id, o.official_id, o.district_id
    from sessions s
    join users u on u.id = s.user_id and u.status = 'ACTIVE'
    left join beneficiaries b on b.user_id = u.id
    left join dealers d on d.user_id = u.id and d.status = 'ACTIVE'
    left join officials o on o.user_id = u.id
    where s.token_hash = ${sha256(token)} and s.expires_at > now() and s.app = ${app}`);
  const r = rows[0];
  if (r) {
    req.user = {
      id: r.id, role: r.role, fullName: r.full_name, app: r.app, sessionId: r.session_id,
      beneficiaryId: r.beneficiary_id, dealerId: r.dealer_id, officialId: r.official_id, districtId: r.district_id,
    };
  }
  next();
}

/** Require a logged-in user with one of the given roles. */
export const requireRole =
  (...roles: RoleName[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new HttpError(401, 'Please log in', 'UNAUTHENTICATED');
    if (!roles.includes(req.user.role)) throw forbidden();
    if (req.user.role === 'DEALER' && !req.user.dealerId) throw forbidden('Your dealer account is not active');
    next();
  };

export const actor = (req: Request): Actor => ({ userId: req.user!.id, role: req.user!.role });
/** Non-null user accessor for routes behind requireRole. */
export const me = (req: Request): AuthUser => req.user!;

export async function audit(req: Request, action: string, entity: string, entityId?: string | null, summary?: unknown, userId?: string, role?: RoleName) {
  await db.execute(sql`
    insert into audit_logs (user_id, role, action, entity, entity_id, change_summary, ip, user_agent)
    values (${userId ?? req.user?.id ?? null}, ${role ?? req.user?.role ?? null}, ${action}, ${entity}, ${entityId ?? null},
            ${summary === undefined ? null : JSON.stringify(summary)}::jsonb, ${req.ip ?? null}, ${req.get('user-agent')?.slice(0, 300) ?? null})`);
}

/** limit/offset from ?page&pageSize. */
export const pageOf = (p: { page: number; pageSize: number }) => ({ limit: p.pageSize, offset: (p.page - 1) * p.pageSize });

/** One JSON line per request. */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') return next();
  const started = performance.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : 'info',
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
        user: req.user?.id,
      }),
    );
  });
  next();
}
