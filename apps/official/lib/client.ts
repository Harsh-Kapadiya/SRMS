'use client';
import { createContext, useContext } from 'react';
import { createApi, type StaffUser } from '@srms/ui';

export const api = createApi('official', () => {
  if (!location.pathname.startsWith('/login')) location.href = '/login';
});

export const UserContext = createContext<StaffUser | null>(null);
export function useUser(): StaffUser {
  const u = useContext(UserContext);
  if (!u) throw new Error('useUser outside the app layout');
  return u;
}

/** District officers are locked to their district; state-level officers choose (null = whole state). */
export const ownDistrict = (u: StaffUser) => u.official?.districtId ?? null;

/** Current IST month as YYYY-MM (for <input type="month">). */
export const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());
