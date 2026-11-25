"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { ReviewError, ReviewField } from "@/components/review/review-ui";
import {
  ReviewApiError,
  signInReviewer,
  type ReviewSessionData,
} from "@/lib/review-client";

export function ReviewLogin({ session }: { session: ReviewSessionData }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [reviewerId, setReviewerId] = useState("");
  const [secret, setSecret] = useState("");

  const signIn = useMutation({
    mutationFn: () => signInReviewer(reviewerId, secret),
    onSuccess: () => {
      setSecret("");
      void queryClient.invalidateQueries({ queryKey: ["review-session"] });
    },
  });

  const unavailable = !session.configured;
  const message =
    signIn.error instanceof ReviewApiError
      ? signIn.error.message
      : signIn.error
        ? "Sign-in failed. Try again."
        : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewerId.trim() || !secret) return;
    signIn.mutate();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-line bg-panel/80 p-5 shadow-2xl shadow-black/30">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-faint transition-colors hover:text-muted focus-visible:outline-2 focus-visible:outline-info"
        >
          <ArrowLeft className="size-3" aria-hidden="true" />
          National dashboard
        </Link>

        <div className="mt-4 flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-info/40 bg-info/10 text-info">
            <LockKeyhole className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-[16px] font-semibold text-ink">
              Reviewer sign-in
            </h1>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Nigeria State Monitor review console. Reviewer actions are
              recorded against a stable operator ID; the session cookie is
              HttpOnly and same-site.
            </p>
          </div>
        </div>

        {unavailable ? (
          <div className="mt-4">
            <ReviewError
              message={
                session.message ??
                "Reviewer authentication is not configured on this deployment."
              }
            />
            <p className="mt-3 rounded-md border border-line bg-canvas-2 px-3 py-2 font-mono text-[10px] leading-relaxed text-faint">
              Required server variables: REVIEWER_CREDENTIALS,
              REVIEWER_SESSION_SECRET, NSM_REPOSITORY=postgres, DATABASE_URL.
            </p>
          </div>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={onSubmit}>
            <ReviewField label="Reviewer ID" htmlFor={`${formId}-reviewer`}>
              <Input
                id={`${formId}-reviewer`}
                name="reviewerId"
                data-testid="review-login-id"
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                required
                pattern="[a-z0-9][a-z0-9._-]{2,63}"
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
                placeholder="e.g. duty.editor"
              />
            </ReviewField>

            <ReviewField
              label="Reviewer secret"
              htmlFor={`${formId}-secret`}
              hint="Checked on the server. The secret is never stored in browser storage."
            >
              <Input
                id={`${formId}-secret`}
                name="secret"
                data-testid="review-login-secret"
                type="password"
                autoComplete="current-password"
                required
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </ReviewField>

            {message ? <ReviewError message={message} /> : null}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              data-testid="review-login-submit"
              disabled={signIn.isPending || !reviewerId.trim() || !secret}
            >
              {signIn.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        <p className="mt-4 border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
          There is no public registration. Credentials are provisioned by the
          deployment operator. No article text or reviewer secret is stored in
          the browser.
        </p>
      </div>
    </main>
  );
}
