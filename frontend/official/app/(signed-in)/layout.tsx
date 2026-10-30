'use client';
import type { ReactNode } from 'react';
import { FileBarChart, LayoutDashboard, MessageSquareWarning, ReceiptText, Store, Users } from 'lucide-react';
import { StaffShell } from '@srms/ui-kit';
import { UserContext, api } from '@/lib/official-api';
import { ScopeProvider } from '@/lib/scope';

const NAV = [
  { href: '/', label: 'Dashboard', icon: <LayoutDashboard /> },
  { href: '/complaints', label: 'Complaints', icon: <MessageSquareWarning /> },
  { href: '/shops', label: 'Shops & stock', icon: <Store /> },
  { href: '/distributions', label: 'Distributions', icon: <ReceiptText /> },
  { href: '/beneficiaries', label: 'Beneficiaries', icon: <Users /> },
  { href: '/reports', label: 'Monthly reports', icon: <FileBarChart /> },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <StaffShell
      api={api}
      appName="Govt Official"
      nav={NAV}
      subtitle={(u) => `${u.official?.designation ?? 'Official'} · ${u.official?.district?.name ?? 'State level'}`}
    >
      {(user) => (
        <UserContext.Provider value={user}>
          <ScopeProvider>{children}</ScopeProvider>
        </UserContext.Provider>
      )}
    </StaffShell>
  );
}
