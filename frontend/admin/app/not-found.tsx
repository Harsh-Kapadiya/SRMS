import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, StatusPage } from '@srms/ui-kit';

export const metadata: Metadata = { title: 'Page not found' };

/** Shown for any address that has no page. */
export default function NotFound() {
  return (
    <StatusPage code="404" title="Page not found" actions={<Link href="/"><Button>Back to the dashboard</Button></Link>}>
      This page does not exist or has moved. Check the address, or go back to the dashboard.
    </StatusPage>
  );
}
