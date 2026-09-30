/** Shapes returned by the SRMS API (docs/api.md) — only the fields this app uses. */
import type { Tone } from '@srms/ui';

export type CardType = 'AAY' | 'PHH';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ComplaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
export const STATUS_TONE: Record<ComplaintStatus, Tone> = { OPEN: 'warn', IN_PROGRESS: 'info', RESOLVED: 'ok', REJECTED: 'neutral' };

export interface District {
  id: number;
  code: string;
  name: string;
  nameHi: string | null;
}

export interface ShopOption {
  id: string;
  shopCode: string;
  name: string;
  address: string;
}

export interface Beneficiary {
  id: string;
  registrationNo: string;
  rationCardNo: string | null;
  name: string;
  guardianName: string | null;
  aadhaarMasked: string;
  mobile: string;
  address: string;
  pincode: string | null;
  districtId: number;
  homeShopId: string | null;
  cardType: CardType;
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  preferredLanguage: 'en' | 'hi';
  registrationDate: string;
  familySize: number;
  familyMembers: { id: string; name: string; relation: string; isHead: boolean }[];
  district: District;
  homeShop: ShopOption | null;
}

export interface Me {
  id: string;
  fullName: string;
  mobile: string;
  beneficiary: Beneficiary | null;
}

export interface EntitlementLine {
  commodityId: number;
  code: string;
  name: string;
  nameHi: string | null;
  unit: string;
  allocated: number;
  issued: number;
  remaining: number;
  availableAtShop: boolean;
}

export interface Entitlement {
  month: string;
  verified: boolean;
  lines: EntitlementLine[];
}

export interface DistributionRow {
  id: string;
  receiptNo: string;
  issuedAt: string;
  status: 'COMPLETED' | 'VOIDED';
  shopCode: string;
  shopName: string;
  items: { code: string; name: string; nameHi: string | null; unit: string; quantity: number }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Receipt {
  id: string;
  receiptNo: string;
  issuedAt: string;
  status: 'COMPLETED' | 'VOIDED';
  authMethod: 'OTP' | 'BIOMETRIC' | 'OFFLINE' | 'MANUAL';
  beneficiary: { name: string; rationCardNo: string | null; cardType: CardType; aadhaarMasked: string };
  shop: { code: string; name: string; address: string; district: string };
  dealer: { name: string; licenseNo: string };
  items: { commodityId: number; code: string; name: string; nameHi: string | null; unit: string; quantity: number; unitPrice: number; amount: number }[];
  totalAmount: number;
}

export interface ComplaintRow {
  id: string;
  ticketNo: string;
  category: string;
  status: ComplaintStatus;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ComplaintDetail extends ComplaintRow {
  resolution: string | null;
  shop: { shopCode: string; name: string } | null;
  assignedOfficial: { name: string; designation: string } | null;
  attachment: { fileName: string; sizeBytes: number } | null;
  events: { id: number; fromStatus: ComplaintStatus | null; toStatus: ComplaintStatus; note: string | null; createdAt: string; actor: { fullName: string; role: string } | null }[];
}

export interface Notification {
  id: string;
  event: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}
