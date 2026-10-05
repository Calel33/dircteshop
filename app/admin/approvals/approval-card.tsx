'use client';

import { ImageIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

import { deriveAgePriority, formatSubmittedAge } from './approval-priority';
import type { ApprovalAction } from './approval-actions-policy';
import type { ApprovalCard } from './approval-types';

const PRIORITY_LABELS = {
  high: 'High priority',
  normal: 'Normal priority',
} as const;

/** Joins the schema address parts into one readable line, skipping blanks. */
function formatAddress(address: ApprovalCard['address']): string {
  const cityLine = [address.city, address.state, address.postalCode]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return [address.addressLine1, address.addressLine2, cityLine, address.country]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join(', ');
}

/** Joins the optional contact fields, skipping absent/blank values. */
function formatContact(card: ApprovalCard): string {
  return [card.phone, card.email]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' · ');
}

/**
 * One pending-review card (issue #13 / B3b todo #4 + #5). Presentational: it
 * derives its priority badge and submission age from the card plus the caller's
 * clock, renders optional fields safely, and offers the three per-card decisions
 * through `onAction` (which opens the confirmation/reason modal). No bulk or
 * side-panel controls.
 */
export function ApprovalQueueCard({
  card,
  now,
  onAction,
}: {
  card: ApprovalCard;
  now: number;
  onAction?: (card: ApprovalCard, action: ApprovalAction) => void;
}) {
  const priority = deriveAgePriority(card.submittedAt, now);
  const address = formatAddress(card.address);
  const contact = formatContact(card);

  return (
    <Card className="h-full gap-gap rounded-card py-card">
      <CardHeader className="px-card">
        <div className="flex flex-col gap-gap sm:flex-row">
          {/*
            No safe storage-URL resolver exists and seeded listings carry no
            photos, so the image is always a token-styled placeholder. The
            card's `imageStorageId` travels as data only, never as a URL.
          */}
          <div
            aria-hidden="true"
            className="bg-muted text-muted-foreground flex aspect-square size-20 shrink-0 items-center justify-center rounded-card border"
          >
            <ImageIcon className="size-8" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="font-display text-lg">{card.name}</CardTitle>
            <p className="text-muted-foreground text-sm">{card.categoryName ?? 'Uncategorized'}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={priority === 'high' ? 'default' : 'secondary'}>
                {PRIORITY_LABELS[priority]}
              </Badge>
              <span className="text-muted-foreground font-label text-xs">
                {formatSubmittedAge(card.submittedAt, now)}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-card">
        <dl className="grid grid-cols-1 gap-gap sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground font-label text-xs uppercase">Owner</dt>
            <dd className="text-sm">{card.ownerLabel ?? 'Unknown owner'}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground font-label text-xs uppercase">Address</dt>
            <dd className="text-sm">{address || 'No address provided'}</dd>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <dt className="text-muted-foreground font-label text-xs uppercase">Contact</dt>
            <dd className="text-sm">{contact || 'No contact details provided'}</dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 px-card">
        <Button type="button" onClick={() => onAction?.(card, 'approve')}>
          Approve
        </Button>
        <Button type="button" variant="outline" onClick={() => onAction?.(card, 'requestChanges')}>
          Request changes
        </Button>
        <Button type="button" variant="destructive" onClick={() => onAction?.(card, 'reject')}>
          Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
