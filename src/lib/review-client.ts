import type { ClusterQueueItem, ClusterScanResult } from "@/lib/clustering/types";
import type { PublishableCandidate } from "@/lib/publication/types";
import type { ReviewCandidate, ReviewCandidateStatus } from "@/lib/review/types";
import type {
  VerificationEventSummary,
  VerificationTransition,
} from "@/lib/verification/types";
import type { VerificationStatus } from "@/lib/types";

export interface ReviewSessionData {
  configured: boolean;
  signedIn: boolean;
  reviewerId: string | null;
  expiresAt: string | null;
  ttlSeconds?: number;
  message?: string;
}

export interface SignedInReviewer {
  reviewerId: string;
  expiresAt: string;
}

export interface ReviewApiFailureBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, string[]>;
  };
  requestId?: string;
}

export class ReviewApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, string[]> | null;

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, string[]> | null = null,
  ) {
    super(message);
    this.name = "ReviewApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type CandidateStatusFilter = ReviewCandidateStatus | "open";
export type ClusterStatusFilter = "pending" | "accepted" | "rejected" | "all";

export type CandidateDecisionInput = {
  action: "accept" | "reject";
  category?: string;
  stateId?: string;
  notes?: string;
};

export interface CandidateDecisionSuccess {
  candidate: ReviewCandidate;
  reviewId: string;
}

export interface ClusterDecisionSuccess {
  ok: true;
  action: "accept" | "reject";
  clusterId: string;
  eventPublicId: string;
  auditId: string;
}

export interface PublicationSuccess {
  ok: true;
  event: {
    eventPublicId: string;
    eventSlug: string;
    title: string;
    category: string;
    stateId: string;
    severity: number;
    verificationStatus: string;
    firstReportedAt: string;
    publishedAt: string;
  };
  linkId: string;
  auditId: string;
  snapshotVersion: string;
}

export interface VerificationTransitionSuccess {
  ok: true;
  transition: VerificationTransition;
  updateId: string;
  auditId: string;
}

interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  let payload: unknown = null;
  if (response.status !== 204) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("nsm:review-unauthorised"));
    }
    const failure = (payload ?? {}) as ReviewApiFailureBody;
    throw new ReviewApiError(
      failure.error?.code ?? "request_failed",
      failure.error?.message ?? `The request failed with HTTP ${response.status}.`,
      response.status,
      failure.error?.details ?? null,
    );
  }

  return (payload as ApiEnvelope<T> | null)?.data as T;
}

export function getReviewSession(): Promise<ReviewSessionData> {
  return request<ReviewSessionData>("/api/review/session");
}

export function signInReviewer(reviewerId: string, secret: string): Promise<SignedInReviewer> {
  return request<SignedInReviewer>("/api/review/session", {
    method: "POST",
    body: JSON.stringify({ reviewerId, secret }),
  });
}

export async function signOutReviewer(): Promise<void> {
  await request<null>("/api/review/session", { method: "DELETE" });
}

export async function listCandidates(
  status: CandidateStatusFilter,
  limit: number,
): Promise<ReviewCandidate[]> {
  const data = await request<{ candidates: ReviewCandidate[] }>(
    `/api/review/candidates?status=${encodeURIComponent(status)}&limit=${limit}`,
  );
  return data.candidates;
}

export function decideCandidate(
  publicId: string,
  input: CandidateDecisionInput,
): Promise<CandidateDecisionSuccess> {
  return request<CandidateDecisionSuccess>(
    `/api/review/candidates/${encodeURIComponent(publicId)}/decision`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export async function listClusters(
  status: ClusterStatusFilter,
  limit: number,
): Promise<ClusterQueueItem[]> {
  const data = await request<{ clusters: ClusterQueueItem[] }>(
    `/api/review/clusters?status=${encodeURIComponent(status)}&limit=${limit}`,
  );
  return data.clusters;
}

export function scanClusters(limit: number): Promise<ClusterScanResult> {
  return request<ClusterScanResult>(`/api/review/clusters/scan?limit=${limit}`, {
    method: "POST",
  });
}

export function decideCluster(
  clusterId: string,
  action: "accept" | "reject",
  notes: string,
): Promise<ClusterDecisionSuccess> {
  return request<ClusterDecisionSuccess>(
    `/api/review/clusters/${encodeURIComponent(clusterId)}/decision`,
    { method: "POST", body: JSON.stringify({ action, notes }) },
  );
}

export async function listPublishable(limit: number): Promise<PublishableCandidate[]> {
  const data = await request<{ candidates: PublishableCandidate[] }>(
    `/api/review/publication?limit=${limit}`,
  );
  return data.candidates;
}

export function publishCandidate(
  publicId: string,
  severity: number,
  rationale: string,
): Promise<PublicationSuccess> {
  return request<PublicationSuccess>(
    `/api/review/publication/${encodeURIComponent(publicId)}`,
    { method: "POST", body: JSON.stringify({ severity, rationale }) },
  );
}

export async function listVerificationEvents(limit: number): Promise<VerificationEventSummary[]> {
  const data = await request<{ events: VerificationEventSummary[] }>(
    `/api/review/verification?limit=${limit}`,
  );
  return data.events;
}

export function transitionVerification(
  eventPublicId: string,
  target: VerificationStatus,
  rationale: string,
  approveCorroboration: boolean,
): Promise<VerificationTransitionSuccess> {
  return request<VerificationTransitionSuccess>(
    `/api/review/verification/${encodeURIComponent(eventPublicId)}`,
    {
      method: "POST",
      body: JSON.stringify({ target, rationale, approveCorroboration }),
    },
  );
}

export type { ReviewCandidate, ReviewCandidateStatus } from "@/lib/review/types";
export type { ClusterQueueItem, ClusterScanResult } from "@/lib/clustering/types";
export type { PublishableCandidate } from "@/lib/publication/types";
export type { VerificationEventSummary } from "@/lib/verification/types";
