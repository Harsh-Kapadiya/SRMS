'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Select, Input } from '@srms/ui-kit';
import { api, ownDistrict, thisMonth, useUser } from './official-api';
import type { District } from './official-types';

/**
 * One month + district scope shared by the dashboard, distributions and reports,
 * so the numbers on every page agree. District officers are locked to theirs.
 */
type Scope = { month: string; setMonth: (m: string) => void; districtId: number | null; setDistrictId: (d: number | null) => void; locked: boolean };
const ScopeContext = createContext<Scope | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const own = ownDistrict(user);
  const [month, setMonth] = useState(thisMonth());
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <ScopeContext.Provider value={{ month, setMonth, districtId: own ?? picked, setDistrictId: setPicked, locked: own !== null }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope() {
  const s = useContext(ScopeContext);
  if (!s) throw new Error('useScope outside ScopeProvider');
  return s;
}

/** `?month=YYYY-MM&districtId=` for API calls. */
export function scopeQuery(s: Scope, withMonth = true) {
  const p = new URLSearchParams();
  if (withMonth) p.set('month', s.month);
  if (s.districtId !== null) p.set('districtId', String(s.districtId));
  return p.toString();
}

/** The filter row that sits above everything it scopes (dataviz: one row, above the charts). */
export function ScopeFilters({ showMonth = true, children }: { showMonth?: boolean; children?: ReactNode }) {
  const s = useScope();
  const user = useUser();
  const districts = api.useGet<District[]>(s.locked ? null : '/public/districts');
  return (
    <div className="no-print mb-6 flex flex-wrap items-end gap-3">
      {showMonth && (
        <label className="space-y-1">
          <span className="block text-xs font-semibold text-ink-3">Month</span>
          <Input type="month" value={s.month} max={thisMonth()} onChange={(e) => e.target.value && s.setMonth(e.target.value)} className="w-44" />
        </label>
      )}
      <label className="space-y-1">
        <span className="block text-xs font-semibold text-ink-3">District</span>
        {s.locked ? (
          <p className="flex min-h-11 items-center rounded-xl border border-line bg-surface-2 px-3.5 font-semibold">{user.official?.district?.name}</p>
        ) : (
          <Select value={s.districtId ?? ''} onChange={(e) => s.setDistrictId(e.target.value ? Number(e.target.value) : null)} className="w-56">
            <option value="">All districts (state)</option>
            {districts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </label>
      {children}
    </div>
  );
}
