import type { Metadata } from "next";
import { ReviewConsole } from "@/components/review/review-console";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reviewer console",
  description:
    "Authenticated Nigeria State Monitor reviewer console for candidate review, cluster review, publication and verification transitions.",
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <ReviewConsole />;
}
