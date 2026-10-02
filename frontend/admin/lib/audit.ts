import type { AuditRow } from './admin-types';

const ENTITY: Record<string, string> = {
  users: 'user account', beneficiaries: 'beneficiary', dealers: 'dealer', officials: 'official', shops: 'shop',
  stock: 'shop stock', stock_movements: 'stock movement', distributions: 'distribution', complaints: 'complaint',
  commodities: 'commodity', entitlement_rules: 'entitlement rule', settings: 'setting', notifications: 'SMS',
  beneficiary_quotas: 'monthly quota', reports: 'report', family_members: 'family member',
};

/** One plain-English line per audit entry, e.g. "updated a shop" or "signed in to the dealer app". */
export function describe(a: AuditRow): string {
  const noun = ENTITY[a.entity] ?? a.entity.replace(/_/g, ' ');
  const thing = `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  const app = typeof a.changes?.app === 'string' ? ` to the ${a.changes.app} app` : '';
  switch (a.action) {
    case 'INSERT': return `created ${thing}`;
    case 'UPDATE': return `updated ${thing}`;
    case 'DELETE': return `deleted ${thing}`;
    case 'LOGIN': return `signed in${app}`;
    case 'LOGIN_FAILED': return `failed to sign in${app}${typeof a.changes?.email === 'string' ? ` as ${a.changes.email}` : ''}`;
    case 'PASSWORD_CHANGED': return 'changed their password';
    case 'PASSWORD_RESET': return 'reset a staff password';
    case 'VOID': return 'voided a ration receipt';
    case 'GENERATE_QUOTAS': return 'generated monthly quotas';
    case 'RETRY_SMS': return 'requeued failed SMS';
    case 'EXPORT_REPORT': return 'exported a monthly report';
    case 'LATE_OFFLINE_SYNC': return 'synced an offline receipt late (flagged for review)';
    default: return `${a.action.toLowerCase().replace(/_/g, ' ')} ${noun}`;
  }
}

export const ACTIONS = ['INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'VOID', 'GENERATE_QUOTAS', 'RETRY_SMS', 'EXPORT_REPORT', 'LATE_OFFLINE_SYNC'];
export const ENTITIES = Object.keys(ENTITY);
