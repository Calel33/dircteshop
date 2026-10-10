'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import type { ApprovalCard, PendingApprovalDetails } from './approval-types';

const HOURS_DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
] as const;

/** Joins the schema address parts into one readable line, skipping blanks. */
function formatAddress(address: PendingApprovalDetails['address']): string {
  const cityLine = [address.city, address.state, address.postalCode]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return [address.addressLine1, address.addressLine2, cityLine, address.country]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join(', ');
}

/** Formats one day's opening periods, or `Closed` when the day is absent/empty. */
function formatPeriods(
  periods: readonly { opensAt: string; closesAt: string }[] | undefined
): string {
  if (!periods || periods.length === 0) {
    return 'Closed';
  }
  return periods.map((period) => `${period.opensAt}–${period.closesAt}`).join(', ');
}

/** One labelled value in the details list; omitted values show a dash. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground font-label text-xs uppercase">{label}</dt>
      <dd className="text-sm break-words">{value.trim().length > 0 ? value : '—'}</dd>
    </div>
  );
}

/** A titled group of `DetailRow`s. */
function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-display text-sm font-semibold">{title}</h3>
      <dl className="grid grid-cols-1 gap-gap sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function DetailsBody({ details }: { details: PendingApprovalDetails }) {
  const listValue = (items: readonly string[]) => (items.length > 0 ? items.join(', ') : '');

  return (
    <div className="flex flex-col gap-gap px-4 pb-6">
      <DetailGroup title="Listing details">
        <DetailRow label="Name" value={details.name} />
        <DetailRow label="Category" value={details.categoryName ?? ''} />
        <div className="sm:col-span-2">
          <DetailRow label="Description" value={details.description} />
        </div>
      </DetailGroup>

      <DetailGroup title="Address & contact">
        <div className="sm:col-span-2">
          <DetailRow label="Address" value={formatAddress(details.address)} />
        </div>
        <DetailRow label="Phone" value={details.phone ?? ''} />
        <DetailRow label="Email" value={details.email ?? ''} />
        <DetailRow label="Website" value={details.website ?? ''} />
      </DetailGroup>

      <DetailGroup title="Operating hours">
        <div className="sm:col-span-2">
          <dl className="flex flex-col gap-1">
            {HOURS_DAYS.map((day) => (
              <div key={day.key} className="flex items-baseline justify-between gap-gap">
                <dt className="text-muted-foreground text-sm">{day.label}</dt>
                <dd className="text-sm">{formatPeriods(details.hours[day.key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      </DetailGroup>

      <DetailGroup title="Categories & features">
        <div className="sm:col-span-2">
          <DetailRow label="Tags" value={listValue(details.tags)} />
        </div>
        <div className="sm:col-span-2">
          <DetailRow label="Amenities" value={listValue(details.amenities)} />
        </div>
        <div className="sm:col-span-2">
          <DetailRow label="Services" value={listValue(details.services)} />
        </div>
        <div className="sm:col-span-2">
          <DetailRow label="Credentials" value={listValue(details.credentials)} />
        </div>
        <div className="sm:col-span-2">
          <DetailRow label="Keywords" value={listValue(details.keywords)} />
        </div>
      </DetailGroup>

      <DetailGroup title="Photos">
        <div className="sm:col-span-2">
          <DetailRow
            label={`Photos (${details.photoCount})`}
            value={
              details.photos.length > 0
                ? details.photos
                    .map((photo, index) => `${index + 1}. ${photo.altText ?? 'No alt text'}`)
                    .join(' · ')
                : ''
            }
          />
        </div>
      </DetailGroup>

      <DetailGroup title="Submission">
        <DetailRow label="Owner" value={details.ownerLabel ?? ''} />
        <DetailRow
          label="Submitted"
          value={details.submittedAt === undefined ? '' : new Date(details.submittedAt).toLocaleString()}
        />
        <DetailRow
          label="Last saved"
          value={details.lastSavedAt === undefined ? '' : new Date(details.lastSavedAt).toLocaleString()}
        />
        <DetailRow label="Last updated" value={new Date(details.lastUpdatedAt).toLocaleString()} />
      </DetailGroup>
    </div>
  );
}

function DetailsLoading() {
  return (
    <div className="flex flex-col gap-gap px-4" aria-busy="true" aria-label="Loading submission">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function DetailsUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-gap px-4" role="status">
      <p className="text-sm">
        This submission is no longer pending review. It may have been approved or changed on another
        device.
      </p>
      <Button type="button" variant="outline" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

/**
 * Full-details side panel (issue #14 / B3c Task 4). A controlled right-side
 * {@link Sheet} that lazily reads the guarded `getPendingApprovalDetails`
 * projection for one still-pending submission. It renders only while a row is
 * open; `details === undefined` is the in-flight read, `null` means the listing
 * left review while the panel was open (stale), and a resolved object renders
 * the confirmed profile. Read-only: it never edits or uploads media.
 */
export function ApprovalDetailsPanel({
  target,
  details,
  onClose,
}: {
  target: ApprovalCard | null;
  details: PendingApprovalDetails | null | undefined;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-gap overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{target?.name ?? 'Submission details'}</SheetTitle>
          <SheetDescription>Full submitted profile for this pending listing.</SheetDescription>
        </SheetHeader>
        {details === undefined ? (
          <DetailsLoading />
        ) : details === null ? (
          <DetailsUnavailable onClose={onClose} />
        ) : (
          <DetailsBody details={details} />
        )}
      </SheetContent>
    </Sheet>
  );
}
