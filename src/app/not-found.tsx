import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel p-6 text-center">
        <Compass className="mx-auto size-6 text-info" aria-hidden />
        <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-faint">404</p>
        <h1 className="mt-1 text-[17px] font-semibold text-ink">No such view</h1>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          This address does not match a Nigeria State Monitor view. The national dashboard is the
          only implemented route in this build.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded border border-info/50 bg-info/10 px-3 py-1.5 text-[11px] text-info transition-colors hover:bg-info/15 focus-visible:outline-2 focus-visible:outline-info"
        >
          Open national dashboard
        </Link>
      </div>
    </main>
  );
}
