import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/dealer-i18n';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Smart Ration — Dealer', template: '%s · Ration Dealer' },
  description: 'Issue ration with Aadhaar OTP and keep shop stock up to date — works without internet.',
  applicationName: 'Ration Dealer',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#16794a' },
    { media: '(prefers-color-scheme: dark)', color: '#111814' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <I18nProvider storageKey="srms-lang-dealer">{children}</I18nProvider>
      </body>
    </html>
  );
}
