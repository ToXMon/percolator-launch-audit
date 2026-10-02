"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long after Privy reports a completed login we wait for `authenticated` to be true before
 * calling the session lost.
 */
export const SESSION_SETTLE_MS = 3000;
/** Connect clicks that leave the user signed out before the reset escape is offered. */
export const LOOP_ATTEMPTS = 2;

/**
 * Detects the "Connect loops" state (GH#2862 sibling): Privy's modal finishes ("Successfully
 * connected with <wallet>"), closes, and the header is still signed out. Two independent signals:
 *   1. Privy's login `onComplete` fired but `authenticated` is still false after SESSION_SETTLE_MS
 *      (the SDK minted a session and then dropped it — see the PR for the SDK evidence);
 *   2. the user has clicked Connect LOOP_ATTEMPTS times in this page without becoming
 *      authenticated (covers a drop that never surfaces `onComplete`).
 * Either makes `needsReset` true so the header can offer "Reset wallet connection". Nothing here
 * opens a wallet prompt or signs; the caller decides what to do with the flag.
 */
export function useSignInLoopRecovery(opts: { ready: boolean; authenticated: boolean }) {
  const { ready, authenticated } = opts;
  const [completedUnauthed, setCompletedUnauthed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const completedAt = useRef<number | null>(null);
  const [completedTick, setCompletedTick] = useState(0);

  /** Call from the login hook's `onComplete`. */
  const noteLoginComplete = useCallback(() => {
    completedAt.current = Date.now();
    setCompletedTick((t) => t + 1);
  }, []);

  /** Call when the user clicks Connect while signed out. */
  const noteConnectAttempt = useCallback(() => setAttempts((a) => a + 1), []);

  useEffect(() => {
    if (authenticated) {
      completedAt.current = null;
      setCompletedUnauthed(false);
      setAttempts(0);
      return;
    }
    if (!ready || completedAt.current === null) return;
    const id = setTimeout(() => setCompletedUnauthed(true), SESSION_SETTLE_MS);
    return () => clearTimeout(id);
  }, [ready, authenticated, completedTick]);

  const needsReset =
    ready && !authenticated && (completedUnauthed || attempts >= LOOP_ATTEMPTS);

  return { needsReset, noteLoginComplete, noteConnectAttempt };
}
