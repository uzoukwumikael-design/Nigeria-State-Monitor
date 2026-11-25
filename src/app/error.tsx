"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-lg border border-critical/30 bg-panel p-6 text-center">
        <TriangleAlert className="mx-auto size-6 text-critical" aria-hidden />
        <h1 className="mt-3 text-[17px] font-semibold text-ink">Dashboard unavailable</h1>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          The national dashboard could not be rendered. No fallback figures are shown because they
          could not be verified.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
            Reference {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex items-center gap-1.5 rounded border border-line-2 bg-panel-2 px-3 py-1.5 text-[11px] text-ink transition-colors hover:bg-panel-3 focus-visible:outline-2 focus-visible:outline-info"
        >
          <RotateCcw className="size-3" aria-hidden /> Retry
        </button>
      </div>
    </main>
  );
}
