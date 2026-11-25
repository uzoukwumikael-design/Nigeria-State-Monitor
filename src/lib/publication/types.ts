export interface PublishableCandidate {
  publicId: string;
  status: "accepted";
  category: string;
  stateId: string;
  stateName: string;
  lga: string | null;
  title: string;
  excerpt: string;
  sourceSlug: string;
  sourceName: string;
  publishedAt: string | null;
  retrievedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface PublishedEvent {
  eventPublicId: string;
  eventSlug: string;
  title: string;
  category: string;
  stateId: string;
  severity: number;
  verificationStatus: string;
  firstReportedAt: string;
  publishedAt: string;
}

export type PublicationStoreErrorCode =
  | "not_found"
  | "not_accepted"
  | "already_linked"
  | "unresolved_category"
  | "unresolved_state"
  | "invalid_severity"
  | "invalid_rationale"
  | "invalid_reviewer"
  | "missing_title";

export type PublicationResult =
  | {
      ok: true;
      event: PublishedEvent;
      linkId: string;
      auditId: string;
      snapshotVersion: string;
    }
  | { ok: false; code: PublicationStoreErrorCode; message: string };
