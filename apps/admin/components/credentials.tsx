'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Alert, Button } from '@srms/ui';
import type { Login } from '@/lib/types';

/** The temporary password exists only in this response — show it once, with a copy button. */
export function Credentials({ login, onDone }: { login: Login; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Email: ${login.email}\nTemporary password: ${login.temporaryPassword}`;
  return (
    <div className="space-y-4">
      <Alert tone="warn" title="Hand these over now — the password is not shown again">
        The person signs in with this temporary password, then sets their own under “Password” in the sidebar.
      </Alert>
      <dl className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
        <dt className="text-ink-3">Email</dt>
        <dd className="font-mono font-semibold">{login.email}</dd>
        <dt className="mt-3 text-ink-3">Temporary password</dt>
        <dd className="font-mono text-lg font-bold tracking-wide">{login.temporaryPassword}</dd>
      </dl>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button className="flex-1" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
