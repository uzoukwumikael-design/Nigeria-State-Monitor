"use client";

import { useId, useState } from "react";
import { FileCheck2, Send } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";
import {
  listPublishable,
  publishCandidate,
  ReviewApiError,
  type PublishableCandidate,
} from "@/lib/review-client";

function PublishCard({
  candidate,
  onPublished,
}: {
  candidate: PublishableCandidate;
  onPublished: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [severity, setSeverity] = useState("3");
  const [rationale, setRationale] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const publish = useMutation({
    mutationFn: () =>
      publishCandidate(candidate.publicId, Number(severity), rationale.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["review-publication"] });
      void queryClient.invalidateQueries({ queryKey: ["review-verification"] });
      onPublished(
        `Published ${result.event.eventPublicId} with severity ${result.event.severity}. Verification is ${result.event.verificationStatus}. Snapshot ${result.snapshotVersion}.`,
      );
      setRationale("");
      setConfirmed(false);
    },
  });

  const error =
    publish.error instanceof ReviewApiError
      ? publish.error
      : publish.error
        ? new ReviewApiError(
            "request_failed",
            "The candidate could not be published.",
            500,
          )
        : null;

  const rationaleReady =
    rationale.trim().length >= 10 && rationale.trim().length <= 500;
  const disabled = publish.isPending || !rationaleReady || !confirmed;

  return (
    <article
      className="rounded-md border border-line bg-canvas-2/50 p-3"
      data-testid={`review-publish-${candidate.publicId}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="positive">accepted candidate</Badge>
        <Badge variant="outline">{candidate.sourceName}</Badge>
        <Badge variant="muted">{candidate.category}</Badge>
        <Badge variant="muted">{candidate.stateName}</Badge>
        <span className="ml-auto font-mono text-[9px] text-faint">
          {formatDateTime(candidate.publishedAt ?? candidate.retrievedAt)}
        </span>
      </div>

      <h3 className="mt-2 text-[13px] font-medium leading-snug text-ink">
        {candidate.title}
      </h3>
      {candidate.excerpt ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {candidate.excerpt}
        </p>
      ) : null}

      <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
        accepted by {candidate.reviewedBy ?? "unknown"} ·{" "}
        {formatDateTime(candidate.reviewedAt)}
      </p>

      <div className="mt-3 space-y-2 border-t border-line pt-3">
        <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
          <ReviewField label="Severity 1–5" htmlFor={`${formId}-severity`}>
            <NativeSelect
              id={`${formId}-severity`}
              className="h-8 w-full"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
            >
              <option value="1">1 · Minor</option>
              <option value="2">2 · Low</option>
              <option value="3">3 · Moderate</option>
              <option value="4">4 · High</option>
              <option value="5">5 · Severe</option>
            </NativeSelect>
          </ReviewField>
          <ReviewField
            label="Severity rationale"
            htmlFor={`${formId}-rationale`}
            hint={`${rationale.trim().length}/500 characters; at least 10 required.`}
          >
            <Textarea
              id={`${formId}-rationale`}
              value={rationale}
              maxLength={500}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Why this severity follows from the reported evidence."
            />
          </ReviewField>
        </div>

        <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] leading-relaxed text-warning">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 accent-warning"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I have reviewed the evidence. I understand this creates a production
            event and a new public dataset snapshot; verification will be
            unassessed.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={disabled}
            onClick={() => publish.mutate()}
          >
            <Send className="size-3.5" aria-hidden="true" />
            {publish.isPending ? "Publishing…" : "Publish production event"}
          </Button>
          <span className="text-[10px] text-faint">
            Requires accepted category and state. Publication does not assert
            that the report is true.
          </span>
        </div>

        {error ? (
          <ReviewError message={error.message} details={error.details} />
        ) : null}
      </div>
    </article>
  );
}

export function PublicationQueue() {
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["review-publication"],
    queryFn: () => listPublishable(50),
  });

  const error =
    query.error instanceof ReviewApiError
      ? query.error.message
      : query.error
        ? "Publishable candidates could not be read."
        : null;

  return (
    <ReviewPanel
      title="Publication"
      description="Accepted candidates with no event outcome. Publishing creates production data; severity and its rationale are supplied by the signed-in reviewer."
      actions={
        <ReviewRefreshButton
          onClick={() => void query.refetch()}
          busy={query.isFetching}
        />
      }
    >
      <ReviewNotice tone="warning">
        Publishing is an explicit production write. It creates one event, its
        primary source link, an immutable candidate link, a timeline entry, an
        audit row and a new production snapshot. It never marks the event
        verified.
      </ReviewNotice>
      {notice ? <ReviewNotice tone="success">{notice}</ReviewNotice> : null}
      {query.isPending ? (
        <ReviewLoading label="Loading publishable candidates" />
      ) : null}
      {error ? <ReviewError message={error} /> : null}
      {query.isSuccess && query.data.length === 0 ? (
        <ReviewEmpty title="No accepted candidates are waiting for publication">
          <span className="inline-flex items-center gap-1.5">
            <FileCheck2 className="size-3.5" aria-hidden="true" />
            Accepted candidates already linked to an event are not listed again.
          </span>
        </ReviewEmpty>
      ) : null}
      {query.data?.map((candidate) => (
        <PublishCard
          key={candidate.publicId}
          candidate={candidate}
          onPublished={(message) => setNotice(message)}
        />
      ))}
    </ReviewPanel>
  );
}
