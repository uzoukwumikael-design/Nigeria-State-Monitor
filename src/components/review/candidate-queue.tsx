"use client";

import { useState } from "react";
import { ExternalLink, Inbox } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, Textarea } from "@/components/ui/primitives";
import {
  ReviewEmpty,
  ReviewError,
  ReviewField,
  ReviewLoading,
  ReviewNotice,
  ReviewPanel,
  ReviewRefreshButton,
} from "@/components/review/review-ui";
import { CATEGORIES } from "@/lib/config";
import { STATES } from "@/lib/geo/states";
import { formatDateTime } from "@/lib/format";
import type { Category } from "@/lib/types";
import {
  decideCandidate,
  listCandidates,
  ReviewApiError,
  type CandidateStatusFilter,
  type ReviewCandidate,
} from "@/lib/review-client";

const STATE_NAME = new Map(STATES.map((state) => [state.id, state.name]));
const CATEGORY_LABEL = new Map(
  CATEGORIES.map((category) => [category.id, category.shortLabel]),
);

function statusVariant(
  status: ReviewCandidate["status"],
): "info" | "warning" | "positive" | "critical" | "default" {
  if (status === "needs_review") return "warning";
  if (status === "pending") return "info";
  if (status === "accepted") return "positive";
  if (status === "rejected") return "critical";
  return "default";
}

function CandidateCard({
  candidate,
  onDecided,
}: {
  candidate: ReviewCandidate;
  onDecided: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<string>(candidate.category ?? "");
  const [stateId, setStateId] = useState<string>(candidate.stateId ?? "");
  const [notes, setNotes] = useState("");

  const decision = useMutation({
    mutationFn: (action: "accept" | "reject") =>
      decideCandidate(candidate.publicId, {
        action,
        category: category || undefined,
        stateId: stateId || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["review-candidates"] });
      void queryClient.invalidateQueries({ queryKey: ["review-publication"] });
      void queryClient.invalidateQueries({ queryKey: ["review-clusters"] });
      onDecided(
        result.candidate.status === "accepted"
          ? `Candidate ${candidate.publicId} accepted. It is not an event yet.`
          : `Candidate ${candidate.publicId} rejected.`,
      );
    },
  });

  const error =
    decision.error instanceof ReviewApiError
      ? decision.error
      : decision.error
        ? new ReviewApiError(
            "request_failed",
            "The decision could not be applied.",
            500,
          )
        : null;

  return (
    <article
      className="rounded-md border border-line bg-canvas-2/50 p-3"
      data-testid={`review-candidate-${candidate.publicId}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={statusVariant(candidate.status)}>
          {candidate.status.replace("_", " ")}
        </Badge>
        <Badge variant="outline">{candidate.article.sourceName}</Badge>
        {category ? (
          <Badge variant="muted">
            {CATEGORY_LABEL.get(category as Category) ?? category}
          </Badge>
        ) : null}
        {stateId ? (
          <Badge variant="muted">{STATE_NAME.get(stateId) ?? stateId}</Badge>
        ) : null}
        <span className="ml-auto font-mono text-[9px] text-faint">
          {formatDateTime(
            candidate.article.publishedAt ?? candidate.article.retrievedAt,
          )}
        </span>
      </div>

      <h3 className="mt-2 text-[13px] font-medium leading-snug text-ink">
        {candidate.article.title}
      </h3>
      {candidate.article.excerpt ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {candidate.article.excerpt}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
        <span>
          category confidence {Math.round(candidate.categoryConfidence * 100)}%
        </span>
        <span>geo confidence {Math.round(candidate.geoConfidence * 100)}%</span>
        {candidate.article.url ? (
          <a
            href={candidate.article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-info transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-info"
          >
            Source article
            <ExternalLink className="size-2.5" aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {candidate.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[10px] leading-relaxed text-faint">
          {candidate.reasons.map((reason) => (
            <li key={reason}>· {reason}</li>
          ))}
        </ul>
      ) : null}

      {candidate.status === "accepted" || candidate.status === "rejected" ? (
        <p className="mt-3 border-t border-line pt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
          {candidate.status} by {candidate.reviewedBy ?? "unknown"} ·{" "}
          {formatDateTime(candidate.reviewedAt)}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-2">
          <ReviewField label="Category" htmlFor={`cat-${candidate.publicId}`}>
            <NativeSelect
              id={`cat-${candidate.publicId}`}
              className="h-8 w-full"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Select category</option>
              {CATEGORIES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </NativeSelect>
          </ReviewField>

          <ReviewField label="State" htmlFor={`state-${candidate.publicId}`}>
            <NativeSelect
              id={`state-${candidate.publicId}`}
              className="h-8 w-full"
              value={stateId}
              onChange={(event) => setStateId(event.target.value)}
            >
              <option value="">Select state</option>
              {STATES.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </NativeSelect>
          </ReviewField>

          <div className="sm:col-span-2">
            <ReviewField
              label="Reviewer notes"
              htmlFor={`notes-${candidate.publicId}`}
              hint="Required to reject (at least 3 characters). Never paste article body text."
            >
              <Textarea
                id={`notes-${candidate.publicId}`}
                value={notes}
                maxLength={1_000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What did you verify or correct?"
              />
            </ReviewField>
          </div>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={decision.isPending || !category || !stateId}
              onClick={() => decision.mutate("accept")}
            >
              {decision.isPending ? "Saving…" : "Accept candidate"}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={decision.isPending || notes.trim().length < 3}
              onClick={() => decision.mutate("reject")}
            >
              Reject candidate
            </Button>
            <span className="self-center text-[10px] text-faint">
              Acceptance resolves category and state; it does not publish.
            </span>
          </div>

          {error ? (
            <div className="sm:col-span-2">
              <ReviewError message={error.message} details={error.details} />
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function CandidateQueue() {
  const [status, setStatus] = useState<CandidateStatusFilter>("open");
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["review-candidates", status],
    queryFn: () => listCandidates(status, 25),
  });

  const error =
    query.error instanceof ReviewApiError
      ? query.error.message
      : query.error
        ? "The review queue could not be read."
        : null;

  return (
    <ReviewPanel
      title="Candidate review"
      description="Captured publisher evidence with deterministic category and geography proposals. Acceptance is not publication: it only resolves the candidate for later publication or cluster attachment."
      actions={
        <>
          <NativeSelect
            aria-label="Candidate status filter"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as CandidateStatusFilter)
            }
          >
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="needs_review">Needs review</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </NativeSelect>
          <ReviewRefreshButton
            onClick={() => void query.refetch()}
            busy={query.isFetching}
          />
        </>
      }
    >
      {notice ? <ReviewNotice tone="success">{notice}</ReviewNotice> : null}
      {query.isPending ? <ReviewLoading label="Loading candidates" /> : null}
      {error ? <ReviewError message={error} /> : null}
      {query.isSuccess && query.data.length === 0 ? (
        <ReviewEmpty title="No candidates in this view">
          <span className="inline-flex items-center gap-1.5">
            <Inbox className="size-3.5" aria-hidden="true" />
            Capture writes candidates only after a feed run. Nothing is created
            here.
          </span>
        </ReviewEmpty>
      ) : null}
      {query.data?.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          onDecided={(message) => setNotice(message)}
        />
      ))}
    </ReviewPanel>
  );
}
