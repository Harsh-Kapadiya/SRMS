'use client';
import { StaffLogin } from '@srms/ui-kit';
import { api } from '@/lib/admin-api';

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export default function LoginPage() {
  return (
    <StaffLogin
      api={api}
      title="System Admin"
      subtitle="Onboard dealers and shops, manage staff accounts, commodities and entitlements, and review the audit trail."
      demo={DEMO ? [{ label: 'System admin', email: 'admin@srms.demo', password: 'Admin@12345' }] : undefined}
    />
  );
}
