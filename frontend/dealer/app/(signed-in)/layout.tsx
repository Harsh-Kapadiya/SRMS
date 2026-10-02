import type { ReactNode } from 'react';
import { DealerShell } from '@/components/dealer-shell';

export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <DealerShell>{children}</DealerShell>;
}
