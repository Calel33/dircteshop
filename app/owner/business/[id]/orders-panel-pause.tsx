'use client';

import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { messageForError } from './photos-panel-helpers';

// Order-commitment protocol T7 (issue #82): the pause control reads the owner
// projection (`getMine` already carries the pause tuple plus `timezone`) and
// writes through the shipped `setAcceptingOrders`. There is no optimistic
// pause state — the banner is derived from the subscription, so the no-op
// guard and the single audit row stay server-owned (INV-22).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Mirrors `MAX_SUPPLY_NOTE_LENGTH` in `convex/supplyAudit.ts`; the server stays
 * the boundary (it trims and rejects a longer note), this only stops over-typing.
 */
const MAX_PAUSE_NOTE_LENGTH = 200;

const PAUSE_PRESETS = [
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hour' },
  { value: 'restOfDay', label: 'Rest of day' },
  { value: 'custom', label: 'Custom' },
] as const;

type PausePreset = (typeof PAUSE_PRESETS)[number]['value'];

/** The owner projection fields this control reads (research Q8). */
type OrderSupplyFields = {
  acceptingOrders?: boolean;
  acceptingOrdersUntil?: number;
  acceptingOrdersNote?: string;
  timezone: string;
};

const ERROR_CLASS =
  'border-danger-border bg-danger-soft text-danger-strong rounded-control border p-3 text-sm';
const BANNER_CLASS =
  'border-warning-border bg-warning-soft text-warning-strong rounded-control flex flex-wrap items-center justify-between gap-2 border p-3';

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Reads an instant as a wall clock in `timeZone` (never the browser zone). */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The zone's UTC offset at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const local = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The absolute instant at which the business's local day ends. It is derived
 * from the business's IANA `timezone`, never the browser's — the offset
 * technique resolves the real UTC instant of local midnight (two passes: the
 * offset at the guessed midnight, then the offset at that candidate), so a DST
 * day is handled rather than assumed to be 24 hours.
 */
function endOfLocalDay(now: Date, timeZone: string): number {
  const local = zonedParts(now, timeZone);
  const nextMidnight = Date.UTC(local.year, local.month - 1, local.day + 1);
  const estimate = nextMidnight - zoneOffsetMs(new Date(nextMidnight), timeZone);
  const until = nextMidnight - zoneOffsetMs(new Date(estimate), timeZone);

  if (until > now.getTime()) {
    return until;
  }
  // Defensive for a zone with a midnight transition: keep the value in the future.
  return estimate > now.getTime() ? estimate : now.getTime() + 24 * HOUR_MS;
}

type UntilOutcome = { ok: true; until: number } | { ok: false; error: string };

/**
 * Preset → absolute timestamp, resolved when the owner submits (never at
 * render time). `Custom` reads the date/time input in the device's local zone;
 * `Rest of day` always uses the business's zone.
 */
function resolveUntil(
  preset: PausePreset,
  customValue: string,
  nowMs: number,
  timeZone: string
): UntilOutcome {
  if (preset === '30m') {
    return { ok: true, until: nowMs + 30 * MINUTE_MS };
  }
  if (preset === '1h') {
    return { ok: true, until: nowMs + HOUR_MS };
  }

  let until: number;
  try {
    until =
      preset === 'restOfDay'
        ? endOfLocalDay(new Date(nowMs), timeZone)
        : new Date(customValue).getTime();
  } catch {
    return { ok: false, error: 'Could not work out that pause time. Choose a custom time instead.' };
  }

  if (!Number.isFinite(until)) {
    return { ok: false, error: 'Choose a date and time for the custom pause.' };
  }
  if (until <= nowMs) {
    return { ok: false, error: 'Choose a pause time in the future.' };
  }
  return { ok: true, until };
}

/** Business-local, unambiguous to the owner (date + time, not just a clock). */
function formatLocalTime(until: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(until));
}

/**
 * Banner copy (plan R2 / research Q8): a past `until` does NOT reopen ordering
 * — the shipped predicate keeps the business closed until Resume — so the
 * banner must show the paused state, never an open one.
 */
function pauseBannerText(
  until: number | undefined,
  note: string,
  timeZone: string,
  nowMs: number
): string {
  if (until === undefined) {
    return note.length === 0 ? 'Ordering paused' : `Ordering paused — ${note}`;
  }

  const formatted = formatLocalTime(until, timeZone);
  if (until <= nowMs) {
    return `Pause ended ${formatted} — press Resume`;
  }
  return note.length === 0 ? `Paused until ${formatted}` : `Paused until ${formatted} — ${note}`;
}

function PauseSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading order pause controls" className="flex justify-end">
      <div className="bg-muted rounded-control h-11 w-32 animate-pulse" />
    </div>
  );
}

/** The preset picker + note form; a pure presentation of the pause dialog. */
function PauseDialog({
  businessId,
  timeZone,
  paused,
}: {
  businessId: Id<'businesses'>;
  timeZone: string;
  paused: boolean;
}) {
  const setAcceptingOrders = useMutation(api.businesses.mutations.setAcceptingOrders);
  const ids = useId();

  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PausePreset>('30m');
  const [customUntil, setCustomUntil] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // A fresh open starts a fresh pause, even after an abandoned attempt.
    setPreset('30m');
    setCustomUntil('');
    setNote('');
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const outcome = resolveUntil(preset, customUntil, Date.now(), timeZone);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }

    setPending(true);
    try {
      await setAcceptingOrders({
        businessId,
        accepting: false,
        until: outcome.until,
        note: note.trim().length === 0 ? null : note.trim(),
      });
      setOpen(false);
    } catch (failure) {
      setError(messageForError(failure, 'Could not pause ordering. Try again.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11">
          {paused ? 'Change pause' : 'Pause orders'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pause online ordering</DialogTitle>
          <DialogDescription>
            New orders are rejected until you resume. Customers can still browse the menu.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <fieldset disabled={pending} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span id={`${ids}-duration`} className="text-sm font-medium">
                Pause for
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={preset}
                aria-labelledby={`${ids}-duration`}
                className="grid w-full grid-cols-2 sm:grid-cols-4"
                onValueChange={(value) => {
                  if (value === '') {
                    return;
                  }
                  setPreset(value as PausePreset);
                  setError(null);
                }}
              >
                {PAUSE_PRESETS.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    className="min-h-11 px-3 text-sm"
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {preset === 'custom' ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${ids}-custom`}>Resume at</Label>
                <Input
                  id={`${ids}-custom`}
                  type="datetime-local"
                  value={customUntil}
                  onChange={(event) => {
                    setCustomUntil(event.target.value);
                    setError(null);
                  }}
                />
                <p className="text-card-muted text-tiny">Shown in your device&apos;s time zone.</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor={`${ids}-note`}>Note (optional)</Label>
              <Textarea
                id={`${ids}-note`}
                rows={2}
                value={note}
                maxLength={MAX_PAUSE_NOTE_LENGTH}
                placeholder="e.g. Kitchen closed for a delivery"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </fieldset>

          {error === null ? null : (
            <p role="alert" className={ERROR_CLASS}>
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="min-h-11" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={pending} aria-busy={pending}>
              {pending ? 'Pausing…' : error === null ? 'Pause orders' : 'Try again'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Owner pause control + paused banner + one-tap Resume. Mounted at the top of
 * the orders board. `getMine` is the subscription the editor already runs for
 * this business; Convex dedupes identical query arguments, so this adds no
 * second backend read.
 */
export function OrdersPauseControl({ businessId }: { businessId: Id<'businesses'> }) {
  const supply = useQuery(api.businesses.queries.getMine, { businessId });
  const setAcceptingOrders = useMutation(api.businesses.mutations.setAcceptingOrders);
  const [resumePending, setResumePending] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  if (supply === undefined) {
    return <PauseSkeleton />;
  }
  if (supply === null) {
    return null;
  }

  const state: OrderSupplyFields = supply;
  const paused = state.acceptingOrders === false;
  const until = state.acceptingOrdersUntil;
  const trimmedNote = state.acceptingOrdersNote?.trim() ?? '';
  const bannerText = pauseBannerText(until, trimmedNote, state.timezone, Date.now());

  async function handleResume() {
    setResumeError(null);
    setResumePending(true);
    try {
      // The mutation force-clears `until` and `note` on resume; both are passed
      // explicitly so the one-tap contract is visible here.
      await setAcceptingOrders({ businessId, accepting: true, until: null, note: null });
    } catch (failure) {
      setResumeError(messageForError(failure, 'Could not resume ordering. Try again.'));
    } finally {
      setResumePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <PauseDialog businessId={businessId} timeZone={state.timezone} paused={paused} />
      </div>

      {paused ? (
        <div role="status" className={BANNER_CLASS}>
          <p className="text-sm font-medium">{bannerText}</p>
          <Button
            type="button"
            className="min-h-11"
            disabled={resumePending}
            aria-busy={resumePending}
            onClick={() => void handleResume()}
          >
            {resumePending ? 'Resuming…' : 'Resume'}
          </Button>
        </div>
      ) : null}

      {resumeError === null ? null : (
        <div
          role="alert"
          className="border-danger-border bg-danger-soft text-danger-strong rounded-control flex flex-wrap items-center justify-between gap-2 border p-3"
        >
          <p className="text-sm">{resumeError}</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={resumePending}
            onClick={() => void handleResume()}
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
