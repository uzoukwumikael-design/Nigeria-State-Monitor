"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReviewPanel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-panel/60">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-ink">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="space-y-3 p-3 sm:p-4">{children}</div>
    </section>
  );
}

export function ReviewError({
  message,
  details,
}: {
  message: string;
  details?: Record<string, string[]> | null;
}) {
  const entries = details ? Object.entries(details) : [];
  return (
    <div
      role="alert"
      className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-[11px] leading-relaxed text-critical"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span>{message}</span>
      </p>
      {entries.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-7 font-mono text-[10px]">
          {entries.map(([field, messages]) => (
            <li key={field}>
              {field}: {messages.join(" ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ReviewNotice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning";
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed",
        tone === "success" && "border-positive/40 bg-positive/10 text-positive",
        tone === "warning" && "border-warning/40 bg-warning/10 text-warning",
        tone === "info" && "border-line-2 bg-panel-2 text-muted",
      )}
    >
      {tone === "success" ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ReviewLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-canvas-2/50 px-3 py-2 text-[11px] text-muted">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ReviewEmpty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-line bg-canvas-2/40 px-4 py-6 text-center">
      <p className="text-[12px] font-medium text-muted">{title}</p>
      {children ? (
        <div className="mt-1 text-[11px] leading-relaxed text-faint">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ReviewField({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="block space-y-1" htmlFor={htmlFor}>
      <span className="block font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[10px] leading-relaxed text-faint">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function ReviewRefreshButton({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={busy}
    >
      {busy ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
