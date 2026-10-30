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
      title="Something went wrong"
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <Link href="/"><Button variant="secondary">Back to the dashboard</Button></Link>
        </>
      }
    >
      This page hit an unexpected problem. Try again, or go back to the dashboard.
    </StatusPage>
  );
}
