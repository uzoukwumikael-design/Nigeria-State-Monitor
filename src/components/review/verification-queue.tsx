"use client";

import { useId, useState } from "react";
import { ShieldCheck } from "lucide-react";
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
import type { VerificationEventSummary } from "@/lib/verification/types";
import type { VerificationStatus } from "@/lib/types";
import {
  listVerificationEvents,
  ReviewApiError,
  transitionVerification,
} from "@/lib/review-client";

function statusVariant(
  status: VerificationStatus,
): "info" | "positive" | "warning" | "critical" | "default" {
  if (status === "corroborated" || status === "official_confirmation")
    return "positive";
  if (status === "multiple_sources") return "info";
  if (status === "disputed") return "warning";
  if (status === "retracted") return "critical";
  if (status === "single_source") return "info";
  return "default";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function VerificationCard({
  event,
  onTransitioned,
}: {
  event: VerificationEventSummary;
  onTransitioned: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [target, setTarget] = useState<string>("");
  const [rationale, setRationale] = useState("");
  const [approved, setApproved] = useState(false);

  const transition = useMutation({
    mutationFn: () =>
      transitionVerification(
        event.eventPublicId,
        target as VerificationStatus,
        rationale.trim(),
        approved,
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["review-verification"] });
      onTransitioned(
        `${result.transition.eventPublicId}: ${statusLabel(result.transition.previousStatus)} → ${statusLabel(result.transition.status)}. ${result.transition.description}`,
      );
      setTarget("");
      setRationale("");
      setApproved(false);
    },
  });

  const error =
    transition.error instanceof ReviewApiError
      ? transition.error
      : transition.error
        ? new ReviewApiError(
            "request_failed",
            "The verification transition could not be applied.",
            500,
          )
        : null;

  const selected = target as VerificationStatus;
  const needsApproval = selected === "corroborated";
  const disabled =
    transition.isPending ||
    !target ||
    rationale.trim().length < 10 ||
    (needsApproval && !approved);

  return (
    <article
      className="rounded-md border border-line bg-canvas-2/50 p-3"
      data-testid={`review-verification-${event.eventPublicId}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={statusVariant(event.verificationStatus)}>
          {statusLabel(event.verificationStatus)}
        </Badge>
        <Badge variant="muted">severity {event.severity}</Badge>
        <Badge variant="outline">
          {event.stateId
            ? (STATE_BY_ID.get(event.stateId)?.name ?? event.stateId)
            : "national"}
        </Badge>
        <span className="ml-auto font-mono text-[9px] text-faint">
          {formatDateTime(event.lastUpdatedAt)}
        </span>
      </div>

      <h3 className="mt-2 text-[13px] font-medium leading-snug text-ink">
        {event.title}
      </h3>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
        {event.articleCount} article link{event.articleCount === 1 ? "" : "s"} ·{" "}
        {event.independentSourceCount} independent group
        {event.independentSourceCount === 1 ? "" : "s"} · {event.conflictGroups}{" "}
        conflict group
        {event.conflictGroups === 1 ? "" : "s"} · {event.retractedCount}{" "}
        retraction
        {event.retractedCount === 1 ? "" : "s"}
      </p>
      <p className="mt-0.5 font-mono text-[9px] text-faint">
        event {event.eventPublicId} · first reported{" "}
        {formatDateTime(event.firstReportedAt)}
      </p>

      {event.allowedTargets.length === 0 ? (
        <p className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
          Retracted is terminal. No further verification transition is
          permitted.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[180px_1fr]">
          <ReviewField label="Allowed target" htmlFor={`${formId}-target`}>
            <NativeSelect
              id={`${formId}-target`}
              className="h-8 w-full"
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setApproved(false);
              }}
            >
              <option value="">Select status</option>
              {event.allowedTargets.map((allowed) => (
                <option key={allowed} value={allowed}>
                  {statusLabel(allowed)}
                </option>
              ))}
            </NativeSelect>
          </ReviewField>

          <ReviewField
            label="Evidence rationale"
            htmlFor={`${formId}-rationale`}
            hint={`${rationale.trim().length}/1000 characters; at least 10 required. Recorded in the audit trail.`}
          >
            <Textarea
              id={`${formId}-rationale`}
              value={rationale}
              maxLength={1_000}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="What evidence supports or contradicts this status?"
            />
          </ReviewField>

          {needsApproval ? (
            <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-[10px] leading-relaxed text-warning sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 size-3.5 accent-warning"
                checked={approved}
                onChange={(input) => setApproved(input.target.checked)}
              />
              <span>
                I explicitly approve corroboration. The evidence must be
                independent and agree beyond the automatic count; article volume
                alone is not corroboration.
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={disabled}
              onClick={() => transition.mutate()}
            >
              Apply transition
            </Button>
            <span className="text-[10px] text-faint">
              This changes verification state, appends a timeline entry and
              writes an audit row.
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

export function VerificationQueue() {
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["review-verification"],
    queryFn: () => listVerificationEvents(50),
  });

  const error =
    query.error instanceof ReviewApiError
      ? query.error.message
      : query.error
        ? "Published events could not be read."
        : null;

  return (
    <ReviewPanel
      title="Verification"
      description="Transitions apply only to existing published production events. Independent source groups, not article counts, drive single-source, multiple-source and corroborated status."
      actions={
        <ReviewRefreshButton
          onClick={() => void query.refetch()}
          busy={query.isFetching}
        />
      }
    >
      <ReviewNotice>
        A shared publisher or independence group counts once. Corroboration
        requires an explicit reviewer approval; retraction is terminal. This
        screen cannot create or publish an event.
      </ReviewNotice>
      {notice ? <ReviewNotice tone="success">{notice}</ReviewNotice> : null}
      {query.isPending ? (
        <ReviewLoading label="Loading published events" />
      ) : null}
      {error ? <ReviewError message={error} /> : null}
      {query.isSuccess && query.data.length === 0 ? (
        <ReviewEmpty title="No published production events">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Publish an accepted candidate first. Demo events are never listed
            here.
          </span>
        </ReviewEmpty>
      ) : null}
      {query.data?.map((event) => (
        <VerificationCard
          key={`${event.eventPublicId}:${event.verificationStatus}`}
          event={event}
          onTransitioned={(message) => setNotice(message)}
        />
      ))}
    </ReviewPanel>
  );
}
