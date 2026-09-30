'use client';
import { StaffLogin } from '@srms/ui';
import { api } from '@/lib/client';

const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export default function LoginPage() {
  return (
    <StaffLogin
      api={api}
      title="Govt Official"
      subtitle="Monitor ration distribution, stock and complaints across shops and districts in real time."
      demo={
        DEMO
          ? [
              { label: 'State level', email: 'official@srms.demo', password: 'Official@12345' },
              { label: 'Patna district', email: 'dso.patna@srms.demo', password: 'Official@12345' },
            ]
          : undefined
      }
    />
  );
}
