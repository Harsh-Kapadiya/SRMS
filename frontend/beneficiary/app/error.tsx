'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { Button, StatusPage } from '@srms/ui-kit';

/** Shown instead of a blank screen when a page crashes; "Try again" re-renders it. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <StatusPage
      code="Error"
      title={<>Something went wrong<span lang="hi" className="block text-xl text-ink-2">कुछ गड़बड़ हो गई</span></>}
      actions={
        <>
          <Button onClick={reset}>Try again · फिर कोशिश करें</Button>
          <Link href="/"><Button variant="secondary">Home · होम</Button></Link>
        </>
      }
    >
      <p>Please try again.</p>
      <p lang="hi">कृपया फिर से कोशिश करें।</p>
    </StatusPage>
  );
}
