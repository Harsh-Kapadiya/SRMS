'use client';
/**
 * Two small SVG charts for the dashboard, following the dataviz method:
 * one y-axis, 2px lines / ≤24px columns with 4px rounded data-ends, hairline
 * grid, legend + selective direct labels, crosshair / per-mark tooltip on hover
 * and keyboard focus, and a table view so no value is tooltip-only.
 * ponytail: hand-rolled SVG instead of a chart library — two chart types, ~200 lines.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const monthLabel = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m.slice(0, 7)}-01T00:00:00Z`));

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), width - 170);
  return (
    <div role="status" className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg" style={{ left, top: Math.max(0, y) }}>
      {children}
    </div>
  );
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="no-print mt-2 text-sm">
      <summary className="cursor-pointer text-ink-3 hover:text-ink">View as table</summary>
      <table className="data-table mt-2">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{head.map((h, i) => <th key={h} className={i ? 'num' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])}>{r.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ─── line chart (percentages over months) ─────────────────────────────────────

export interface LineSeries {
  key: string;
  label: string;
  color: string; // CSS colour, e.g. var(--series-1)
  values: number[];
}

export function LineChart({ title, months, series, height = 240, max = 100, unit = '%' }: { title: string; months: string[]; series: LineSeries[]; height?: number; max?: number; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { top: 14, right: 128, bottom: 28, left: 40 };
  const w = Math.max(0, width - M.left - M.right);
  const h = height - M.top - M.bottom;
  const x = (i: number) => M.left + (months.length > 1 ? (i / (months.length - 1)) * w : w / 2);
  const y = (v: number) => M.top + h - (Math.min(v, max) / max) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const last = months.length - 1;
  const fmt = (v: number) => `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}${unit}`;

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(last, Math.round(rel * last))));
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((i) => Math.min(last, (i ?? -1) + 1));
    if (e.key === 'ArrowLeft') setHover((i) => Math.max(0, (i ?? last + 1) - 1));
  };

  // End labels: nudge apart only if they would overlap.
  const ends = series.map((s) => ({ s, y: y(s.values[last] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 16) ends[i]!.y = ends[i - 1]!.y + 16;

  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-bold">{title}</span>
        <span className="flex flex-wrap gap-3 text-sm text-ink-2" aria-label="Legend">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" /></svg>
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${title}. ${series.map((s) => `${s.label} ${fmt(s.values[last] ?? 0)} in ${monthLabel(months[last]!)}`).join('; ')}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[11px] tabular-nums">{t}{unit}</text>
              </g>
            ))}
            {months.map((m, i) => (
              <text key={m} x={x(i)} y={height - 8} textAnchor="middle" className={i === hover ? 'fill-ink text-[11px] font-semibold' : 'fill-ink-3 text-[11px]'}>{monthLabel(m)}</text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + h} stroke="var(--axis)" strokeWidth="1" />}
            {series.map((s) => (
              <g key={s.key}>
                <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
                {(hover === null ? [last] : [hover]).map((i) => (
                  <circle key={i} cx={x(i)} cy={y(s.values[i] ?? 0)} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                ))}
              </g>
            ))}
            {ends.map(({ s, y: ly }) => (
              <text key={s.key} x={M.left + w + 10} y={ly} dy="0.32em" className="fill-ink-2 text-[12px] font-semibold">
                {fmt(s.values[last] ?? 0)} <tspan className="fill-ink-3 font-normal">{s.label.split(' ')[0]}</tspan>
              </text>
            ))}
            <rect
              x={M.left}
              y={M.top}
              width={w}
              height={h}
              fill="transparent"
              tabIndex={0}
              aria-label={`${title}: use left and right arrow keys to read each month`}
              className="cursor-crosshair outline-none focus-visible:stroke-[var(--brand)]"
              onPointerMove={pick}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(last)}
              onBlur={() => setHover(null)}
              onKeyDown={keys}
            />
          </svg>
        )}
        {hover !== null && (
          <Tooltip x={x(hover)} y={M.top} width={width}>
            <p className="mb-1 text-xs font-semibold text-ink-3">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${months[hover]!.slice(0, 7)}-01T00:00:00Z`))}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-2">
                <svg width="12" height="4" aria-hidden><line x1="0" y1="2" x2="12" y2="2" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" /></svg>
                <span className="font-bold tabular-nums">{fmt(s.values[hover] ?? 0)}</span>
                <span className="text-ink-3">{s.label}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
      <TableView caption={title} head={['Month', ...series.map((s) => s.label)]} rows={months.map((m, i) => [monthLabel(m), ...series.map((s) => fmt(s.values[i] ?? 0))])} />
    </figure>
  );
}

// ─── column chart (one series over months) ───────────────────────────────────

export function ColumnChart({ title, months, values, color, height = 240, unit = '%', note }: { title: string; months: string[]; values: number[]; color: string; height?: number; unit?: string; note?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { top: 22, right: 8, bottom: 28, left: 40 };
  const w = Math.max(0, width - M.left - M.right);
  const h = height - M.top - M.bottom;
  const peak = Math.max(...values, 0);
  const max = peak <= 0 ? 1 : Math.ceil((peak * 1.2) / (peak > 5 ? 5 : 1)) * (peak > 5 ? 5 : 1);
  const band = months.length ? w / months.length : 0;
  const barW = Math.min(24, band * 0.5);
  const y = (v: number) => M.top + h - (v / max) * h;
  const fmt = (v: number) => `${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}${unit}`;
  const ticks = [0, max / 2, max];

  return (
    <figure>
      <figcaption className="mb-2">
        <span className="font-bold">{title}</span>
        {note && <span className="ml-2 text-sm text-ink-3">{note}</span>}
      </figcaption>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${title}: ${months.map((m, i) => `${monthLabel(m)} ${fmt(values[i] ?? 0)}`).join(', ')}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 text-[11px] tabular-nums">{fmt(t)}</text>
              </g>
            ))}
            {months.map((m, i) => {
              const v = values[i] ?? 0;
              const cx = M.left + band * i + band / 2;
              const top = y(v);
              const bh = M.top + h - top;
              const r = Math.min(4, bh);
              return (
                <g key={m}>
                  {bh > 0 && (
                    <path
                      d={`M${cx - barW / 2},${M.top + h} V${top + r} Q${cx - barW / 2},${top} ${cx - barW / 2 + r},${top} H${cx + barW / 2 - r} Q${cx + barW / 2},${top} ${cx + barW / 2},${top + r} V${M.top + h} Z`}
                      fill={color}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  )}
                  <text x={cx} y={top - 6} textAnchor="middle" className="fill-ink-2 text-[11px] font-semibold tabular-nums">{fmt(v)}</text>
                  <text x={cx} y={height - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">{monthLabel(m)}</text>
                  <rect
                    x={cx - band / 2}
                    y={M.top}
                    width={band}
                    height={h}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${monthLabel(m)}: ${fmt(v)}`}
                    className="outline-none"
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && (
          <Tooltip x={M.left + band * hover + band / 2} y={y(values[hover] ?? 0) - 56} width={width}>
            <p className="font-bold tabular-nums">{fmt(values[hover] ?? 0)}</p>
            <p className="text-ink-3">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${months[hover]!.slice(0, 7)}-01T00:00:00Z`))}</p>
          </Tooltip>
        )}
      </div>
      <TableView caption={title} head={['Month', title]} rows={months.map((m, i) => [monthLabel(m), fmt(values[i] ?? 0)])} />
    </figure>
  );
}
