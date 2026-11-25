"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CandidateQueue } from "@/components/review/candidate-queue";
import { ClusterQueue } from "@/components/review/cluster-queue";
import { PublicationQueue } from "@/components/review/publication-queue";
import { ReviewLogin } from "@/components/review/review-login";
import {
  ReviewError,
  ReviewLoading,
  ReviewNotice,
} from "@/components/review/review-ui";
import { VerificationQueue } from "@/components/review/verification-queue";
import { formatDateTime } from "@/lib/format";
import {
  getReviewSession,
  ReviewApiError,
  signOutReviewer,
  type ReviewSessionData,
} from "@/lib/review-client";

function SessionShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-canvas px-3 py-4 sm:px-6 sm:py-6">
      {children}
    </main>
  );
}

export function ReviewConsole() {
  const queryClient = useQueryClient();

  useEffect(() => {
    function unauthorised() {
      void queryClient.invalidateQueries({ queryKey: ["review-session"] });
    }
    window.addEventListener("nsm:review-unauthorised", unauthorised);
    return () =>
      window.removeEventListener("nsm:review-unauthorised", unauthorised);
  }, [queryClient]);

  const session = useQuery({
    queryKey: ["review-session"],
    queryFn: getReviewSession,
    staleTime: 0,
    retry: false,
  });

  if (session.isPending) {
    return (
      <SessionShell>
        <div className="mx-auto max-w-5xl">
          <ReviewLoading label="Checking reviewer session" />
        </div>
      </SessionShell>
    );
  }

  if (session.isError) {
    return (
      <SessionShell>
        <div className="mx-auto max-w-xl space-y-3">
          <ReviewError
            message={
              session.error instanceof ReviewApiError
                ? session.error.message
                : "The reviewer session could not be checked."
            }
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void session.refetch()}
          >
            Try again
          </Button>
          <Link
            href="/"
            className="block text-[11px] text-info underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-info"
          >
            Return to the national dashboard
          </Link>
        </div>
      </SessionShell>
    );
  }

  const data: ReviewSessionData = session.data;
  if (!data.signedIn) {
    return <ReviewLogin session={data} />;
  }

  return <ReviewWorkspace session={data} />;
}

function ReviewWorkspace({ session }: { session: ReviewSessionData }) {
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: signOutReviewer,
    onSuccess: () => {
      queryClient.clear();
      void queryClient.invalidateQueries({ queryKey: ["review-session"] });
    },
  });

  return (
    <SessionShell>
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-faint transition-colors hover:text-muted focus-visible:outline-2 focus-visible:outline-info"
            >
              <ArrowLeft className="size-3" aria-hidden="true" />
              National dashboard
            </Link>
            <h1 className="mt-1.5 text-[17px] font-semibold text-ink">
              Reviewer console
            </h1>
            <p className="mt-0.5 text-[11px] text-muted">
              Signed in as{" "}
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink">
                {session.reviewerId}
              </span>{" "}
              · session expires {formatDateTime(session.expiresAt)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </header>

        {signOut.error ? (
          <div className="mt-3">
            <ReviewError message="Sign-out failed. Close the browser tab or try again." />
          </div>
        ) : null}

        <div className="mt-3">
          <ReviewNotice tone="warning">
            <span className="inline-flex items-start gap-1.5">
              <ShieldAlert
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                Production review surface. Candidate and cluster decisions never
                publish an event; only the Publication tab creates production
                data. Every action is recorded against the signed-in reviewer
                ID.
              </span>
            </span>
          </ReviewNotice>
        </div>

        <Tabs defaultValue="candidates" className="mt-3">
          <TabsList aria-label="Reviewer queues">
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="clusters">Clusters</TabsTrigger>
            <TabsTrigger value="publication">Publication</TabsTrigger>
            <TabsTrigger value="verification">Verification</TabsTrigger>
          </TabsList>
          <TabsContent value="candidates" className="mt-3">
            <CandidateQueue />
          </TabsContent>
          <TabsContent value="clusters" className="mt-3">
            <ClusterQueue />
          </TabsContent>
          <TabsContent value="publication" className="mt-3">
            <PublicationQueue />
          </TabsContent>
          <TabsContent value="verification" className="mt-3">
            <VerificationQueue />
          </TabsContent>
        </Tabs>

        <footer className="mt-6 border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
          Reviewer actions are server-side. The console cannot read demo events,
          raw feed bodies or article full text. If this deployment is not
          configured for production Postgres, the queues return an explicit
          unavailable state.
        </footer>
      </div>
    </SessionShell>
  );
}
