import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getSnapshot } from "@/lib/data";
import { viewFromNextSearchParams } from "@/lib/url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "National dashboard",
  description:
    "Nigeria State Monitor national dashboard: all 36 states and the Federal Capital Territory, reported-event intelligence, evidence and analytics.",
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const snapshot = await getSnapshot();
  const initialView = viewFromNextSearchParams(params);
  return <Dashboard snapshot={snapshot} initialView={initialView} />;
}
