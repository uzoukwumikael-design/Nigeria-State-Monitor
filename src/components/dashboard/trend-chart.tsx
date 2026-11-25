"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/lib/intelligence";

interface TooltipItem {
  value?: number | string;
  dataKey?: string;
  color?: string;
  name?: string;
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded border border-line-2 bg-canvas-2 px-2.5 py-1.5 text-[10px] shadow-xl">
      <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-faint">
        {label}
      </p>
      <div className="mt-1 space-y-0.5">
        {payload.map((item) => (
          <p key={item.dataKey} className="flex items-center gap-2 text-muted">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: item.color ?? "#35bdf2" }}
              aria-hidden
            />
            <span>{item.name ?? item.dataKey}</span>
            <span className="ml-auto font-mono tabular text-ink">
              {item.value ?? 0}
            </span>
          </p>
        ))}
      </div>
      <p className="mt-1 border-t border-line/70 pt-1 font-mono text-[7.5px] uppercase tracking-[0.06em] text-faint">
        reported volume · not incidence
      </p>
    </div>
  );
}

export function TrendChart({
  data,
  accent = "#35bdf2",
  gradientId = "nsm-trend-total",
}: {
  data: TrendPoint[];
  accent?: string;
  gradientId?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 6, right: 6, bottom: 0, left: -22 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.32} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="#1b2638"
          strokeDasharray="2 4"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: "#64748b", fontSize: 8 }}
          tickLine={false}
          axisLine={{ stroke: "#202b3d" }}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis
          allowDecimals={false}
          width={30}
          tick={{ fill: "#64748b", fontSize: 8 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<TrendTooltip />}
          cursor={{ stroke: "#2b3a51", strokeDasharray: "3 3" }}
        />
        <Area
          type="monotone"
          dataKey="total"
          name="Reported events"
          stroke={accent}
          strokeWidth={1.4}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="severity4Plus"
          name="Severity 4–5"
          stroke="#ffb020"
          strokeWidth={1}
          strokeDasharray="3 2"
          fill="transparent"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
