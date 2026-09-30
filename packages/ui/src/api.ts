'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AppName } from '@srms/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Client for the SRMS API. Calls go to the app's own /api/* (a Next.js rewrite
 * to the API), so the session cookie stays first-party. Every call carries the
 * X-SRMS-App header the API requires.
 */
export function createApi(app: AppName, onUnauthorized?: () => void) {
  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const isFile = typeof Blob !== 'undefined' && body instanceof Blob;
    const headers: Record<string, string> = { 'x-srms-app': app };
    if (isFile) {
      headers['content-type'] = (body as Blob).type || 'application/octet-stream';
      if (body instanceof File) headers['x-file-name'] = encodeURIComponent(body.name);
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isFile ? (body as Blob) : JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'No internet connection. Please try again.');
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null))?.error as { code?: string; message?: string; issues?: ApiError['issues'] } | undefined;
      // Only an expired/missing session logs out; a wrong password (BAD_CREDENTIALS) is an ordinary form error.
      if (err?.code === 'UNAUTHENTICATED') onUnauthorized?.();
      throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? 'Something went wrong. Please try again.', err?.issues);
    }
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
  }

  /** Load data for a component; `path = null` skips. Re-runs when path changes. */
  function useGet<T>(path: string | null) {
    const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: path !== null });
    const [tick, setTick] = useState(0);
    useEffect(() => {
      if (path === null) return;
      let live = true;
      setState((s) => ({ ...s, loading: true }));
      request<T>('GET', path).then(
        (data) => live && setState({ data, loading: false }),
        (error: ApiError) => live && setState((s) => ({ data: s.data, error, loading: false })),
      );
      return () => {
        live = false;
      };
    }, [path, tick]);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    return { ...state, reload };
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
    upload: <T>(path: string, file: File) => request<T>('POST', path, file),
    useGet,
  };
}
