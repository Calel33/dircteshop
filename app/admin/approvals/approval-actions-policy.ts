/**
 * Pure decision policy for the `/admin/approvals` per-card actions
 * (issue #13 / B3b todo #5). No React, no Convex imports: this is the client
 * mirror of the authoritative server policy in
 * `convex/businesses/moderationPolicy.ts` (`assertModerationReason` /
 * `normalizeModerationReason`). The server remains the security boundary; these
 * helpers only decide what the modal offers and what it sends.
 *
 * Approval needs no reason. Changes and Reject require a non-blank (trimmed)
 * reason. Mirrors the `editor-status.ts` / `approval-priority.ts` pure-module
 * pattern so it can be pinned with `node --test` (the repo has no React runner).
 */

/** The only three queue decisions (SPEC §10). Suspend/Restore stay out of scope. */
export const APPROVAL_ACTIONS = ['approve', 'requestChanges', 'reject'] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** Whether the action shows the required reason field and enforces a reason. */
export function actionRequiresReason(action: ApprovalAction): boolean {
  return action !== 'approve';
}

/**
 * Submit-enabled logic for the modal's confirm button. `approve` is always
 * submittable; `requestChanges`/`reject` need a reason with non-whitespace text.
 * The server re-validates, so a race cannot submit a blank reason.
 */
export function canSubmitDecision(action: ApprovalAction, reason: string): boolean {
  if (!actionRequiresReason(action)) {
    return true;
  }

  return reason.trim().length > 0;
}

/**
 * The value sent to `moderateListing`. `approve` sends no reason (and clears any
 * stale one server-side); Changes/Reject send the trimmed reason.
 */
export function normalizeReason(action: ApprovalAction, reason: string): string | undefined {
  if (!actionRequiresReason(action)) {
    return undefined;
  }

  return reason.trim();
}
