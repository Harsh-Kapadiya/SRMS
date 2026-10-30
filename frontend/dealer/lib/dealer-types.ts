/** Shapes returned by the SRMS dealer API (backend/api/src/routes/dealer.ts) — only the fields this app uses. */
import type { StaffUser } from '@srms/ui-kit';

export type Me = StaffUser;

export interface Commodity {
  id: number;
  code: string;
  name: string;
  nameHi: string | null;
  unit: string;
  pricePerUnit: number;
  isActive: boolean;
}

export interface StockLine {
  commodityId: number;
  name: string;
  unit: string;
  quantityAvailable: number;
  monthlyQuota: number;
  lowStockThreshold: number;
  isLow: boolean;
}

export interface Shop {
  id: string;
  shopCode: string;
  name: string;
  address: string;
  status: string;
  stock: StockLine[];
  stats: { today: number; monthTransactions: number; servedThisMonth: number; homeBeneficiaries: number };
}

/** This month's remaining quota per home beneficiary — cached for offline issuing. */
export interface Roster {
  month: string;
  generatedAt: string;
  beneficiaries: {
    id: string;
    name: string;
    rationCardNo: string | null;
    cardType: 'AAY' | 'PHH';
    mobileMasked: string;
    aadhaarMasked: string;
    quota: { commodityId: number; allocated: number; remaining: number }[];
  }[];
}

export interface Lookup {
  beneficiary: {
    id: string;
    name: string;
    rationCardNo: string | null;
    cardType: 'AAY' | 'PHH';
    aadhaarMasked: string;
    mobileMasked: string;
    familySize: number | null;
    portability: boolean;
  };
  eligible: boolean;
  reason: string | null;
  reasonCode: 'VERIFICATION_PENDING' | 'VERIFICATION_REJECTED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_INACTIVE' | null;
  requireOtp: boolean;
  lines: { commodityId: number; allocated: number; remaining: number; inStock: number; maxIssuable: number; pricePerUnit: number }[];
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
  items: { commodityId: number; name: string; nameHi: string | null; unit: string; quantity: number; unitPrice: number; amount: number }[];
  totalAmount: number;
}

export interface DistributionRow {
  id: string;
  receiptNo: string;
  issuedAt: string;
  status: 'COMPLETED' | 'VOIDED';
  offline: boolean;
  syncedLate: boolean;
  beneficiaryName: string;
  rationCardNo: string | null;
  items: { code: string; name: string; nameHi: string | null; unit: string; quantity: number }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Movement {
  id: number;
  type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT';
  reason: string | null;
  quantity: number;
  balanceAfter: number;
  referenceNo: string | null;
  occurredAt: string;
  commodity: string;
  unit: string;
}

export interface Alert {
  id: string;
  event: string;
  message: string;
  payload: { shopId?: string; commodityId?: number; quantityAvailable?: number; threshold?: number } | null;
  createdAt: string;
  readAt: string | null;
}
