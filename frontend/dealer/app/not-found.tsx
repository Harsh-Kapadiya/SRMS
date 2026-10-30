import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, StatusPage } from '@srms/ui-kit';

export const metadata: Metadata = { title: 'Page not found' };

/** Shown for any address that has no page. */
export default function NotFound() {
  return (
    <StatusPage code="404" title={<>Page not found<span lang="hi" className="block text-xl text-ink-2">पेज नहीं मिला</span></>} actions={<Link href="/"><Button>Home · होम</Button></Link>}>
      <p>This page does not exist or has moved.</p>
      <p lang="hi">यह पेज मौजूद नहीं है या हटा दिया गया है।</p>
    </StatusPage>
  );
}
