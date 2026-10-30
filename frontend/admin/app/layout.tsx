import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Toaster } from '@srms/ui-kit';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SRMS Admin', template: '%s · SRMS Admin' },
  description: 'System administration for the Smart Ration Distribution System.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
