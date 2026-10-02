/** Shapes returned by the SRMS API (docs/api.md) — only the fields this app uses. */
import type { Tone } from '@srms/ui-kit';

export type ComplaintStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
export const STATUS_TONE: Record<ComplaintStatus, Tone> = { OPEN: 'warn', IN_PROGRESS: 'info', RESOLVED: 'ok', REJECTED: 'neutral' };
export const STATUS_LABEL: Record<ComplaintStatus, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', REJECTED: 'Rejected' };
export const CATEGORY_LABEL: Record<string, string> = {
  DEALER_BEHAVIOUR: 'Dealer behaviour',
  SHORT_WEIGHT: 'Short weight',
  POOR_QUALITY: 'Poor quality',
  OVERCHARGING: 'Overcharging',
  SHOP_CLOSED: 'Shop closed',
  DENIED_RATION: 'Ration denied',
  OTHER: 'Other',
};

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

export interface Dashboard {
  month: string;
  districtId: number | null;
  kpis: {
    verifiedBeneficiaries: number;
    pendingVerification: number;
    activeShops: number;
    activeDealers: number;
    served: number;
    transactions: number;
    offlineTransactions: number;
    coveragePct: number;
    allocated: number;
    issued: number;
    offtakePct: number;
    received: number;
    leakagePct: number;
    wastagePct: number;
    lowStockItems: number;
  };
  commodities: { commodityId: number; code: string; name: string; unit: string; allocated: number; issued: number; received: number; wastage: number; leakage: number; stock: number; offtakePct: number }[];
  trend: { month: string; served: number; coveragePct: number; allocated: number; issued: number; offtakePct: number; leakagePct: number }[];
  districts: { districtId: number; name: string; verified: number; served: number; coveragePct: number; received: number; issued: number; leakage: number; leakagePct: number; lowStock: number; openComplaints: number }[];
  lowStock: { shopId: string; shopCode: string; shopName: string; commodity: string; unit: string; dealer: string | null; quantityAvailable: number; threshold: number; pctOfQuota: number }[];
  leakageShops: { shopId: string; shopCode: string; shopName: string; dealer: string | null; received: number; leakage: number; leakagePct: number }[];
  complaints: { open: number; inProgress: number; filedThisMonth: number; resolvedThisMonth: number; avgResolutionHours: number | null; openByCategory: { category: string; count: number }[] };
}

export interface ShopRow {
  id: string;
  shopCode: string;
  name: string;
  address: string;
  status: string;
  districtId: number;
  district: string;
  dealer: string | null;
  dealerMobile: string | null;
  lowStock: number;
  beneficiaries: number;
  openComplaints: number;
}

export interface StockLine {
  commodityId: number;
  code: string;
  name: string;
  unit: string;
  quantityAvailable: number;
  monthlyQuota: number;
  lowStockThreshold: number;
  isLow: boolean;
  pctOfQuota: number | null;
}

export interface Movement {
  id: number;
  type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';
  reason: string | null;
  quantity: number;
  balanceAfter: number;
  referenceNo: string | null;
  note: string | null;
  occurredAt: string;
  commodity: string;
  unit: string;
  by: string | null;
}

export interface DistributionRow {
  id: string;
  receiptNo: string;
  issuedAt: string;
  status: 'COMPLETED' | 'VOIDED';
  authMethod: string;
  offline: boolean;
  /** Offline receipt synced after the admin's offline_max_hours setting — needs review. */
  syncedLate: boolean;
  beneficiaryName: string;
  rationCardNo: string | null;
  shopCode: string;
  shopName: string;
  items: { code: string; name: string; unit: string; quantity: number }[];
}

export interface Receipt {
  id: string;
  receiptNo: string;
  issuedAt: string;
  status: 'COMPLETED' | 'VOIDED';
  authMethod: string;
  capturedOfflineAt: string | null;
  beneficiary: { name: string; rationCardNo: string | null; cardType: string; aadhaarMasked: string };
  shop: { code: string; name: string; address: string; district: string };
  dealer: { name: string; licenseNo: string };
  items: { commodityId: number; name: string; unit: string; quantity: number; unitPrice: number; amount: number }[];
  totalAmount: number;
}

export interface BeneficiaryRow {
  id: string;
  registrationNo: string;
  rationCardNo: string | null;
  name: string;
  mobileMasked: string;
  aadhaarMasked: string;
  cardType: 'AAY' | 'PHH';
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  registeredAt: string;
  district: string;
  shopCode: string | null;
  shopName: string | null;
  familySize: number;
}

export interface ComplaintRow {
  id: string;
  ticketNo: string;
  category: string;
  status: ComplaintStatus;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  beneficiary: string;
  shopCode: string | null;
  shopName: string | null;
  assignedTo: string | null;
  hasAttachment: boolean;
}

export interface ComplaintDetail {
  id: string;
  ticketNo: string;
  category: string;
  status: ComplaintStatus;
  description: string;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  shop: { id: string; shopCode: string; name: string } | null;
  dealer: { id: string; name: string; licenseNo: string } | null;
  beneficiary: { id: string; name: string; rationCardNo: string | null; mobile: string };
  assignedOfficial: { name: string; designation: string } | null;
  attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null;
  events: { id: number; fromStatus: ComplaintStatus | null; toStatus: ComplaintStatus; note: string | null; createdAt: string; actor: { fullName: string; role: string } | null }[];
}

export interface MonthlyReport {
  month: string;
  generatedAt: string;
  districts: { district: string; shops: number; home: number; served: number; transactions: number; allocated: number; received: number; issued: number; wastage: number; leakage: number; coveragePct: number; offtakePct: number; leakagePct: number }[];
  shops: { district: string; shopId: string; shopCode: string; shopName: string; dealer: string; home: number; served: number; transactions: number; coveragePct: number }[];
  lines: { district: string; shopCode: string; commodity: string; unit: string; opening: number; received: number; issued: number; wastage: number; leakage: number; excess: number; closing: number; allocated: number; undistributed: number; offtakePct: number }[];
}
