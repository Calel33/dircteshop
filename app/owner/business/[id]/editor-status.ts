import type { ListingStatus } from '@/convex/businesses/helpers';

// Pure status/action/banner/history derivation for the owner editor (issue #12 /
// B3a todo #10). Framework-free with only a type-only import, so every mapping is
// unit-testable under `node --test` (editor-status.test.ts). The React shell owns
// only rendering, mutation calls, and loading state.

/**
 * The owner-initiated lifecycle actions the editor can offer. `publish`
 * persists approved content-only edits in place (no status change); `resubmit`
 * sends staged core-identity edits back for review.
 */
export type EditorActionKind = 'submit' | 'resubmit' | 'revise' | 'publish';

/** Visual tone of a status banner; the UI maps it to semantic design tokens. */
export type BannerTone = 'info' | 'warning' | 'danger' | 'brand';

export interface StatusBanner {
  tone: BannerTone;
  title: string;
  message: string;
  /** Submission timestamp, surfaced only by the pending-review banner. */
  submittedAt?: number;
}

export interface PrimaryActionInput {
  status: ListingStatus;
  /** True when approved core-identity edits are staged client-side. */
  coreStaged: boolean;
  /** True when approved content edits are staged client-side. */
  contentDirty: boolean;
}

export interface StatusBannerInput {
  status: ListingStatus;
  /**
   * Moderator-provided reason. Per contract §9.1 it is surfaced only for
   * `changesRequested` / `rejected`, where the owner can act on it.
   */
  moderationReason?: string;
  submittedAt?: number;
  coreStaged?: boolean;
}

/** Document timestamps/status the history trail derives from. */
export interface HistorySource {
  _creationTime: number;
  status: ListingStatus;
  lastSavedAt?: number;
  lastUpdatedAt: number;
  submittedAt?: number;
  moderatedAt?: number;
}

export interface HistoryEntry {
  label: string;
  at: number;
}

const EDITABLE_STATUSES: ReadonlySet<ListingStatus> = new Set([
  'draft',
  'changesRequested',
  'approved',
]);

/** Whether the owner may edit a listing in the given status (contract §5). */
export function isEditableStatus(status: ListingStatus): boolean {
  return EDITABLE_STATUSES.has(status);
}

/**
 * The single primary lifecycle action for the current status, or `null` when the
 * status offers none. Pending/suspended are read-only. An approved listing with
 * staged core-identity edits resubmits; with content-only dirt it publishes in
 * place; with nothing staged it offers no primary action.
 */
export function getPrimaryAction({
  status,
  coreStaged,
  contentDirty,
}: PrimaryActionInput): EditorActionKind | null {
  if (status === 'draft' || status === 'changesRequested') {
    return 'submit';
  }
  if (status === 'rejected') {
    return 'revise';
  }
  if (status === 'approved') {
    if (coreStaged) {
      return 'resubmit';
    }
    if (contentDirty) {
      return 'publish';
    }
  }
  return null;
}

const PRIMARY_ACTION_LABELS: Record<EditorActionKind, string> = {
  submit: 'Submit for approval',
  resubmit: 'Submit changes for review',
  revise: 'Revise listing',
  publish: 'Publish changes',
};

export function getPrimaryActionLabel(action: EditorActionKind): string {
  return PRIMARY_ACTION_LABELS[action];
}

/**
 * Label for the plain save button. An approved listing's content edits publish
 * immediately, so its save reads "Save changes" rather than "Save draft".
 */
export function getSaveActionLabel(status: ListingStatus): string {
  return status === 'approved' ? 'Save changes' : 'Save draft';
}

export interface SaveAvailabilityInput {
  /** True for pending/suspended/rejected listings. */
  readOnly: boolean;
  /** True while a mutation is in flight. */
  busy: boolean;
  /** Number of fields a plain Save Draft would persist. */
  savableCount: number;
  /** Pre-save validation error for the savable fields, if any. */
  saveNameError: string | null;
  primaryAction: EditorActionKind | null;
  /** Pre-action validation error for the primary action's fields, if any. */
  primaryNameError: string | null;
}

export interface SaveAvailability {
  canSave: boolean;
  canRunPrimary: boolean;
}

/**
 * Whether the save and primary-action buttons are enabled. Save Draft is never
 * offered on a read-only listing; Revise is available even on a read-only
 * (rejected) one, because reopening as a draft is exactly the way out. Publish
 * mirrors the content save — it is enabled purely by savable content edits, with
 * no name-error gate, because name never persists on that path.
 */
export function getSaveAvailability({
  readOnly,
  busy,
  savableCount,
  saveNameError,
  primaryAction,
  primaryNameError,
}: SaveAvailabilityInput): SaveAvailability {
  if (busy) {
    return { canSave: false, canRunPrimary: false };
  }

  const canRunPrimary =
    primaryAction === null
      ? false
      : primaryAction === 'revise'
        ? true
        : primaryAction === 'publish'
          ? !readOnly && savableCount > 0
          : primaryNameError === null;

  return {
    canSave: !readOnly && savableCount > 0 && saveNameError === null,
    canRunPrimary,
  };
}

function withReason(message: string, reason: string | undefined): string {
  const trimmed = (reason ?? '').trim();
  return trimmed.length === 0 ? message : `${message} ${trimmed}`;
}

/**
 * Banner state for the current status (contract §5 / prototype). Keyed off
 * `status`; `moderationReason` is read only for the two statuses where the owner
 * can act on it (§9.1 policy).
 */
export function getStatusBanner({
  status,
  moderationReason,
  submittedAt,
  coreStaged = false,
}: StatusBannerInput): StatusBanner | null {
  if (status === 'pendingReview') {
    return {
      tone: 'info',
      title: 'Submitted — pending review',
      message: 'This listing is read-only while a moderator reviews it.',
      ...(submittedAt === undefined ? {} : { submittedAt }),
    };
  }
  if (status === 'changesRequested') {
    return {
      tone: 'warning',
      title: 'Changes requested',
      message: withReason(
        'A moderator asked for changes. Editing is re-enabled — revise and submit again.',
        moderationReason
      ),
    };
  }
  if (status === 'rejected') {
    return {
      tone: 'danger',
      title: 'Listing rejected',
      message: withReason(
        'This listing was not approved. Revise it to make changes, then submit again.',
        moderationReason
      ),
    };
  }
  if (status === 'suspended') {
    return {
      tone: 'danger',
      title: 'Listing suspended',
      message: 'A moderator suspended this listing; it is hidden from the public and read-only.',
    };
  }
  if (status === 'approved' && coreStaged) {
    return {
      tone: 'brand',
      title: 'Core identity changes staged',
      message:
        'Name, category, description and address are core identity. Saving and resubmitting sends this approved listing back for review; content edits publish immediately.',
    };
  }
  return null;
}

const MODERATION_LABELS: Record<string, string> = {
  approved: 'Approved by moderator',
  changesRequested: 'Changes requested by moderator',
  rejected: 'Rejected by moderator',
  suspended: 'Suspended by moderator',
};

/**
 * Minimal change history: a saved/status trail derived only from document
 * timestamps — never field-level diffs. Newest first, with the generic "Last
 * updated" entry dropped whenever a more specific event shares its timestamp
 * (every lifecycle mutation stamps `lastUpdatedAt`).
 */
export function deriveHistoryEntries(source: HistorySource): HistoryEntry[] {
  const specificTimestamps = new Set<number | undefined>([
    source._creationTime,
    source.lastSavedAt,
    source.submittedAt,
    source.moderatedAt,
  ]);
  const entries: HistoryEntry[] = [];

  const push = (label: string, at: number | undefined) => {
    if (at !== undefined) {
      entries.push({ label, at });
    }
  };

  push('Listing created', source._creationTime);
  if (!specificTimestamps.has(source.lastUpdatedAt)) {
    push('Last updated', source.lastUpdatedAt);
  }
  if (source.lastSavedAt !== undefined && source.lastSavedAt !== source._creationTime) {
    push('Draft saved', source.lastSavedAt);
  }
  push('Submitted for review', source.submittedAt);
  push(MODERATION_LABELS[source.status] ?? 'Moderator update', source.moderatedAt);

  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      const key = `${entry.label}@${entry.at}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.at - a.at);
}
