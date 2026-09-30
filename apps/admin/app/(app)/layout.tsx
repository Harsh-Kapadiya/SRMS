'use client';
import type { ReactNode } from 'react';
import { Gauge, History, MessageSquareText, Settings, ShieldCheck, Store, Truck, UserCog, Wheat } from 'lucide-react';
import { StaffShell } from '@srms/ui';
import { UserContext, api } from '@/lib/client';

const NAV = [
  { href: '/', label: 'Overview', icon: <Gauge /> },
  { href: '/dealers', label: 'Dealers', icon: <Truck /> },
  { href: '/shops', label: 'Shops', icon: <Store /> },
  { href: '/officials', label: 'Officials', icon: <ShieldCheck /> },
  { href: '/users', label: 'All users', icon: <UserCog /> },
  { href: '/commodities', label: 'Commodities & quotas', icon: <Wheat /> },
  { href: '/settings', label: 'Settings', icon: <Settings /> },
  { href: '/audit', label: 'Audit log', icon: <History /> },
  { href: '/sms', label: 'SMS log', icon: <MessageSquareText /> },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <StaffShell api={api} appName="System Admin" nav={NAV} subtitle={(u) => u.email ?? 'Administrator'}>
      {(user) => <UserContext.Provider value={user}>{children}</UserContext.Provider>}
    </StaffShell>
  );
}
