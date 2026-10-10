"use client";

import { useState } from "react";

export type BarDatum = { key: string; label: string; value: number; detail?: string };

/**
 * Single-series column chart: thin columns with 4px rounded tops anchored to one baseline,
 * hairline grid, hover tooltip per column, the maximum labelled directly and a hidden data table.
 * Color: brand teal #22a28c (validated for light and dark surfaces).
 */
export function BarChart({
  data,
  height = 180,
  valueLabel,
  formatValue = (v) => String(v),
}: {
  data: BarDatum[];
  height?: number;
  valueLabel: string;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = niceCeil(max);
  const ticks = [0, niceMax / 2, niceMax];
  const maxIndex = data.findIndex((d) => d.value === max && max > 0);
  const width = 640;
  const padL = 36;
  const padB = 22;
  const padT = 18;
  const plotW = width - padL - 4;
  const plotH = height - padB - padT;
  const band = plotW / data.length;
  const barW = Math.min(24, band - 2);
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={valueLabel}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={width - 4}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(0, (d.value / niceMax) * plotH);
          const x = padL + i * band + (band - barW) / 2;
          const top = padT + plotH - h;
          const r = Math.min(4, h);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Generous hit target: the whole column band */}
              <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${padT + plotH} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${padT + plotH} Z`}
                  fill="#22a28c"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              ) : null}
              {i === maxIndex ? (
                <text
                  x={x + barW / 2}
                  y={top - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text)"
                >
                  {formatValue(d.value)}
                </text>
              ) : null}
              {i % Math.ceil(data.length / 7) === 0 || i === data.length - 1 ? (
                <text
                  x={padL + i * band + band / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] ? (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-default surface px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((padL + hover * band + band / 2) / width) * 100}%`, top: 0 }}
        >
          <div className="font-medium">{data[hover]!.label}</div>
          <div className="text-muted">
            {valueLabel}:{" "}
            <span className="font-medium text-[var(--text)]">
              {formatValue(data[hover]!.value)}
            </span>
          </div>
          {data[hover]!.detail ? <div className="text-muted">{data[hover]!.detail}</div> : null}
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{valueLabel}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th>{d.label}</th>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceCeil(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function compact(v: number) {
  return v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v));
}
