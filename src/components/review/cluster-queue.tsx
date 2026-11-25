"use client";

import { useState } from "react";
import { GitMerge, Radar } from "lucide-react";
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
import { STATE_BY_ID } from "@/lib/geo/states";
import { formatDateTime } from "@/lib/format";
import {
  decideCluster,
  listClusters,
  ReviewApiError,
  scanClusters,
  type ClusterQueueItem,
  type ClusterStatusFilter,
} from "@/lib/review-client";

function stateName(stateId: string): string {
  return STATE_BY_ID.get(stateId)?.name ?? stateId;
}

function ClusterCard({
  cluster,
  onDecided,
}: {
  cluster: ClusterQueueItem;
  onDecided: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const decision = useMutation({
    mutationFn: (action: "accept" | "reject") =>
      decideCluster(cluster.id, action, notes.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["review-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["review-verification"] });
      onDecided(
        result.action === "accept"
          ? `Supporting evidence attached to ${result.eventPublicId}. Verification was not changed.`
          : `Cluster pair rejected. No evidence was attached to ${result.eventPublicId}.`,
      );
    },
  });

  const error =
    decision.error instanceof ReviewApiError
      ? decision.error
      : decision.error
        ? new ReviewApiError(
            "request_failed",
            "The cluster decision could not be applied.",
            500,
          )
        : null;

  const pending = cluster.decision === "pending";

  return (
    <article
      className="rounded-md border border-line bg-canvas-2/50 p-3"
      data-testid={`review-cluster-${cluster.id}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={
            cluster.decision === "pending"
              ? "warning"
              : cluster.decision === "accepted"
                ? "positive"
                : "critical"
          }
        >
          {cluster.decision}
        </Badge>
        <Badge variant="outline">
          score{" "}
          {cluster.similarity == null ? "gated" : cluster.similarity.toFixed(3)}
        </Badge>
        <Badge variant="muted">
          {stateName(cluster.candidate.stateId)} · {cluster.candidate.category}
        </Badge>
        <span className="ml-auto font-mono text-[9px] text-faint">
          {formatDateTime(cluster.candidate.publishedAt)}
        </span>
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
            Candidate
          </p>
          <h3 className="mt-0.5 text-[12px] font-medium leading-snug text-ink">
            {cluster.candidate.title}
          </h3>
          <p className="mt-0.5 text-[10px] text-muted">
            {cluster.candidate.sourceName}
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
            Existing event
          </p>
          <h3 className="mt-0.5 text-[12px] font-medium leading-snug text-ink">
            {cluster.event.title}
          </h3>
          <p className="mt-0.5 text-[10px] text-muted">
            first reported {formatDateTime(cluster.event.firstReportedAt)}
          </p>
        </div>
      </div>

      {cluster.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
          {cluster.reasons.map((reason) => (
            <li key={reason}>· {reason}</li>
          ))}
        </ul>
      ) : null}

      {pending ? (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <ReviewField
            label="Reviewer notes"
            htmlFor={`cluster-notes-${cluster.id}`}
            hint="Required (10–1000 characters). State why the records do or do not describe the same event."
          >
            <Textarea
              id={`cluster-notes-${cluster.id}`}
              value={notes}
              maxLength={1_000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Explain the decision."
            />
          </ReviewField>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={decision.isPending || notes.trim().length < 10}
              onClick={() => decision.mutate("accept")}
            >
              Attach as supporting evidence
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={decision.isPending || notes.trim().length < 10}
              onClick={() => decision.mutate("reject")}
            >
              Keep records separate
            </Button>
            <span className="text-[10px] text-faint">
              A score alone never merges records. Attachment does not publish or
              verify.
            </span>
          </div>
          {error ? (
            <ReviewError message={error.message} details={error.details} />
          ) : null}
        </div>
      ) : (
        <p className="mt-3 border-t border-line pt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
          {cluster.decision} by {cluster.reviewedBy ?? "unknown"} ·{" "}
          {formatDateTime(cluster.reviewedAt)}
        </p>
      )}

      <p className="mt-1 font-mono text-[9px] text-faint">
        rule {cluster.ruleVersion ?? "unknown"} · cluster{" "}
        {cluster.clusterReference}
      </p>
    </article>
  );
}

export function ClusterQueue() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ClusterStatusFilter>("pending");
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["review-clusters", status],
    queryFn: () => listClusters(status, 50),
  });

  const scan = useMutation({
    mutationFn: () => scanClusters(50),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["review-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["review-verification"] });
      setNotice(
        `Scan complete: ${result.scannedCandidates} candidates, ${result.comparedEvents} comparisons, ${result.queuedForReview} queued, ${result.autoAttached} auto-attached, ${result.skipped} skipped.`,
      );
    },
  });

  const error =
    query.error instanceof ReviewApiError
      ? query.error.message
      : query.error
        ? "The cluster queue could not be read."
        : null;
  const scanError =
    scan.error instanceof ReviewApiError
      ? scan.error.message
      : scan.error
        ? "The cluster scan could not be completed."
        : null;

  return (
    <ReviewPanel
      title="Cluster review"
      description="Near-duplicate publisher reports assessed against published events. Category, state and a 72-hour window are hard gates; the similarity score never overrides an LGA or headline-number conflict."
      actions={
        <>
          <NativeSelect
            aria-label="Cluster status filter"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as ClusterStatusFilter)
            }
          >
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </NativeSelect>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={scan.isPending}
            onClick={() => scan.mutate()}
          >
            <Radar className="size-3.5" aria-hidden="true" />
            {scan.isPending ? "Scanning…" : "Run scan"}
          </Button>
          <ReviewRefreshButton
            onClick={() => void query.refetch()}
            busy={query.isFetching}
          />
        </>
      }
    >
      {notice ? <ReviewNotice tone="success">{notice}</ReviewNotice> : null}
      {scanError ? <ReviewError message={scanError} /> : null}
      {query.isPending ? <ReviewLoading label="Loading clusters" /> : null}
      {error ? <ReviewError message={error} /> : null}
      {query.isSuccess && query.data.length === 0 ? (
        <ReviewEmpty title="No cluster assessments in this view">
          <span className="inline-flex items-center gap-1.5">
            <GitMerge className="size-3.5" aria-hidden="true" />
            Run a scan after accepting candidates. Below-threshold pairs stay
            separate and are not stored.
          </span>
        </ReviewEmpty>
      ) : null}
      {query.data?.map((cluster) => (
        <ClusterCard
          key={cluster.id}
          cluster={cluster}
          onDecided={(message) => setNotice(message)}
        />
      ))}
    </ReviewPanel>
  );
}
