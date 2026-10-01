/** Shapes returned by the SRMS admin API (backend/api/src/routes/admin.ts) — only the fields this app uses. */
import type { Tone } from '@srms/ui-kit';

export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export const STATUS_TONE: Record<string, Tone> = { ACTIVE: 'ok', INACTIVE: 'neutral', SUSPENDED: 'bad' };
export const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended' };
export const ROLE_LABEL: Record<string, string> = { BENEFICIARY: 'Beneficiary', DEALER: 'Dealer', OFFICIAL: 'Official', ADMIN: 'Admin' };

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface District {
  id: number;
  code: string;
  name: string;
}

export interface Overview {
  dealers: number;
  shops: number;
  shopsUnassigned: number;
  officials: number;
  beneficiaries: number;
  pending: number;
  smsQueued: number;
  smsFailed: number;
  audit24h: number;
  failedLogins24h: number;
}

/** Returned once when a staff account is created or its password is reset. */
export interface Login {
  email: string;
  temporaryPassword: string;
}

export interface Dealer {
  id: string;
  userId: string;
  name: string;
  licenseNo: string;
  licenseValidUntil: string | null;
  mobile: string;
  address: string | null;
  districtId: number;
  status: AccountStatus;
  district: District;
  user: { email: string; status: AccountStatus; lastLoginAt: string | null };
  shops: { id: string; shopCode: string; name: string; status: string }[];
}

export interface Official {
  id: string;
  userId: string;
  name: string;
  designation: string;
  districtId: number | null;
  mobile: string;
  district: District | null;
  user: { email: string; status: AccountStatus; lastLoginAt: string | null };
}

export interface Shop {
  id: string;
  shopCode: string;
  name: string;
  address: string;
  districtId: number;
  dealerId: string | null;
  latitude: number | null;
  longitude: number | null;
  status: 'ACTIVE' | 'INACTIVE';
  district: District;
  dealer: { id: string; name: string; licenseNo: string; status: string } | null;
  stock: { commodityId: number; quantityAvailable: number; monthlyQuota: number; lowStockThreshold: number; commodity: { code: string; name: string; unit: string } }[];
}

export interface Commodity {
  id: number;
  code: string;
  name: string;
  nameHi: string | null;
  unit: 'KG' | 'LITRE' | 'PACKET';
  pricePerUnit: number;
  isActive: boolean;
  sortOrder: number;
}

export interface EntitlementRule {
  commodityId: number;
  cardType: 'AAY' | 'PHH';
  qtyPerMember: number;
  qtyPerFamily: number;
  isActive: boolean;
}

export interface Setting {
  key: string;
  value: number | boolean | string;
  description: string | null;
  updatedAt: string;
}

export interface UserRow {
  id: string;
  role: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  status: AccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: number;
  userId: string | null;
  userName: string;
  role: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  at: string;
}

export interface SmsRow {
  id: string;
  event: string;
  mobile: string | null;
  message: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
  provider: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}
