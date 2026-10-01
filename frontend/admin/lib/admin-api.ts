'use client';
import type { ZodType, z } from 'zod';
import { createContext, useContext } from 'react';
import { createApi, type StaffUser } from '@srms/ui-kit';
import type { District } from './admin-types';

export const api = createApi('admin', () => {
  if (!location.pathname.startsWith('/login')) location.href = '/login';
});

export const UserContext = createContext<StaffUser | null>(null);
/** The signed-in admin (provided by the app layout). */
export function useUser(): StaffUser {
  const u = useContext(UserContext);
  if (!u) throw new Error('useUser outside the app layout');
  return u;
}

/** All districts of the state (reference data, same for every page). */
export const useDistricts = () => api.useGet<District[]>('/public/districts');

/** Current IST month as YYYY-MM (for <input type="month">). */
export const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());

/** Read an <input type="number"> value; empty stays empty so validation can say so. */
export const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));

const MESSAGES: Record<string, string> = {
  name: 'Enter a name (at least 2 characters).',
  email: 'Enter a valid email address.',
  mobile: 'Enter a valid 10-digit mobile number.',
  licenseNo: 'Enter the licence number.',
  licenseValidUntil: 'Enter a valid date.',
  districtId: 'Choose a district.',
  designation: 'Enter the designation.',
  shopCode: 'Use 3–20 capital letters, digits or hyphens, e.g. FPS-PAT-0006.',
  address: 'Enter the full address (at least 5 characters).',
  code: 'Use 2–20 capital letters or underscores, e.g. DAL.',
  pricePerUnit: 'Enter a price of 0 or more.',
  latitude: 'Latitude must be between −90 and 90.',
  longitude: 'Longitude must be between −180 and 180.',
  low_stock_pct: 'Enter a whole number from 1 to 90.',
  max_shops_per_dealer: 'Enter a whole number from 1 to 20.',
  otp_ttl_seconds: 'Enter a whole number of seconds from 60 to 1800.',
  offline_max_hours: 'Enter a whole number of hours from 1 to 720.',
  state_name: 'Enter the state name.',
};

/** Validate with the same shared zod schema the API uses; returns friendly per-field messages. */
export function validate<S extends ZodType>(schema: S, value: unknown): { data: z.output<S>; errors?: undefined } | { data?: undefined; errors: Record<string, string> } {
  const r = schema.safeParse(value);
  if (r.success) return { data: r.data };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = String(i.path[0] ?? '');
    errors[key] ??= MESSAGES[key] ?? i.message;
  }
  return { errors };
}
