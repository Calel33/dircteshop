'use client';

import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ApprovalQueueCard } from './approval-card';
import { selectAllCheckedValue, selectedCountOnPage } from './approval-selection';
import { ApprovalQueueEmpty, ApprovalQueueError, ApprovalQueueLoading } from './approval-states';
import type {
  ApprovalCard,
  ApprovalCategoryOption,
  ApprovalFilters,
  ApprovalPriorityFilter,
  ApprovalQueueProps,
  ApprovalTimeFilter,
} from './approval-types';

const PRIORITY_OPTIONS: { value: ApprovalPriorityFilter; label: string }[] = [
  { value: 'all', label: 'All priorities' },
  { value: 'high', label: 'High priority' },
  { value: 'normal', label: 'Normal priority' },
];

const TIME_OPTIONS: { value: ApprovalTimeFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const ALL_CATEGORIES = 'all';

/** Category / priority / submission-time filter controls (SPEC §10). */
function QueueFilterBar({
  filters,
  categories,
  onChange,
}: {
  filters: ApprovalFilters;
  categories: readonly ApprovalCategoryOption[];
  onChange: (next: ApprovalFilters) => void;
}) {
  const categoryId = useId();
  const priorityId = useId();
  const timeId = useId();

  return (
    <div className="flex flex-wrap items-end gap-gap" role="group" aria-label="Queue filters">
      <div className="flex flex-col gap-1">
        <Label htmlFor={categoryId}>Category</Label>
        <Select
          value={filters.categoryId ?? ALL_CATEGORIES}
          onValueChange={(value) =>
            onChange({
              ...filters,
              categoryId: value === ALL_CATEGORIES ? undefined : value,
            })
          }
        >
          <SelectTrigger id={categoryId} className="w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category._id} value={category._id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={priorityId}>Priority</Label>
        <Select
          value={filters.priority}
          onValueChange={(value) => onChange({ ...filters, priority: value as ApprovalPriorityFilter })}
        >
          <SelectTrigger id={priorityId} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={timeId}>Submitted</Label>
        <Select
          value={filters.time}
          onValueChange={(value) => onChange({ ...filters, time: value as ApprovalTimeFilter })}
        >
          <SelectTrigger id={timeId} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Page-scoped select-all control with an indeterminate partial state. */
function QueueSelectionHeader({
  selectedIds,
  pageIds,
  state,
  onToggleAll,
}: {
  selectedIds: ReadonlySet<string>;
  pageIds: readonly string[];
  state: ApprovalQueueProps['selection']['state'];
  onToggleAll: (checked: boolean) => void;
}) {
  const selectAllId = useId();
  const selectedCount = selectedCountOnPage(selectedIds, pageIds);

  return (
    <div className="flex items-center gap-3">
      <Checkbox
        id={selectAllId}
        checked={selectAllCheckedValue(state)}
        onCheckedChange={(checked) => onToggleAll(checked === true)}
        aria-label="Select all listings on this page"
      />
      <Label htmlFor={selectAllId} className="text-sm">
        Select all on this page
      </Label>
      {selectedCount > 0 ? (
        <span className="text-muted-foreground text-sm" role="status">
          {selectedCount} selected
        </span>
      ) : null}
    </div>
  );
}

/** Empty state shown when filters (not an empty queue) produced no rows. */
function ApprovalQueueFilteredEmpty() {
  return (
    <Card role="status" className="rounded-card py-card text-center">
      <CardHeader>
        <CardTitle className="font-display text-lg">No submissions match these filters</CardTitle>
        <CardDescription>
          Try a broader category, priority, or time range. Pending submissions always appear when the
          filters are cleared.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

/** The card list with the per-card selection + View Full Details trigger. */
function QueueList({
  cards,
  now,
  onAction,
  onViewDetails,
  selection,
}: {
  cards: readonly ApprovalCard[];
  now: number;
  onAction?: ApprovalQueueProps['onAction'];
  onViewDetails?: ApprovalQueueProps['onViewDetails'];
  selection: ApprovalQueueProps['selection'];
}) {
  return (
    <ul className="grid grid-cols-1 gap-gap lg:grid-cols-2">
      {cards.map((card) => {
        const cardCheckboxId = `select-${card._id}`;
        return (
          <li key={card._id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={cardCheckboxId}
                  checked={selection.selectedIds.has(card._id)}
                  onCheckedChange={(checked) => selection.onToggleOne(card._id, checked === true)}
                  aria-label={`Select ${card.name}`}
                />
                <Label htmlFor={cardCheckboxId} className="text-muted-foreground text-xs">
                  Select
                </Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onViewDetails?.(card)}
              >
                View full details
              </Button>
            </div>
            <ApprovalQueueCard card={card} now={now} onAction={onAction} />
          </li>
        );
      })}
    </ul>
  );
}

/** Renders the one presentational body state the queue is currently in. */
function QueueBody({
  state,
  cards,
  errorMessage,
  onRetry,
  onAction,
  onViewDetails,
  selection,
  now,
  isFiltered,
}: {
  state: ApprovalQueueProps['state'];
  cards: readonly ApprovalCard[];
  errorMessage?: string;
  onRetry?: () => void;
  onAction?: ApprovalQueueProps['onAction'];
  onViewDetails?: ApprovalQueueProps['onViewDetails'];
  selection: ApprovalQueueProps['selection'];
  now: number;
  isFiltered: boolean;
}) {
  if (state === 'loading') {
    return <ApprovalQueueLoading />;
  }
  if (state === 'error') {
    return <ApprovalQueueError message={errorMessage} onRetry={onRetry} />;
  }
  if (state === 'ready' && cards.length > 0) {
    return (
      <QueueList
        cards={cards}
        now={now}
        onAction={onAction}
        onViewDetails={onViewDetails}
        selection={selection}
      />
    );
  }
  if (isFiltered) {
    return <ApprovalQueueFilteredEmpty />;
  }
  return <ApprovalQueueEmpty />;
}

/** Previous/Next cursor navigation, plus a large-page split notice. */
function QueuePagination({
  hasPrevious,
  hasNext,
  pageStatus,
  onPrevious,
  onNext,
}: ApprovalQueueProps['pagination']) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      {pageStatus === 'SplitRequired' ? (
        <p role="status" className="text-muted-foreground text-sm">
          This page is large. Splitting it into smaller pages so no submissions are skipped.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onPrevious} disabled={!hasPrevious}>
          Previous
        </Button>
        <Button type="button" variant="outline" onClick={onNext} disabled={!hasNext}>
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * `/admin/approvals` queue (issue #13 / B3b, extended by B3c / #14 Task 3).
 *
 * Presentational: the route shell owns the live Convex cursor query and all
 * state. This surface renders the category/priority/time filters, the
 * page-scoped select-all control (with an indeterminate partial state), the
 * per-card selection + View Full Details trigger, and Previous/Next cursor
 * navigation. Select-all affects only the rendered page; the selected count is
 * derived from the actual page ids, never a fixed page size.
 */
export function ApprovalQueue({
  state,
  cards,
  errorMessage,
  onRetry,
  onAction,
  onViewDetails,
  filters,
  categories,
  onFiltersChange,
  selection,
  bulkActions,
  pagination,
  now,
}: ApprovalQueueProps) {
  const pageIds = cards.map((card) => card._id);
  const isFiltered =
    filters.categoryId !== undefined || filters.priority !== 'all' || filters.time !== 'all';

  return (
    <section aria-labelledby="approvals-heading" className="flex flex-col gap-gap">
      <header className="flex flex-col gap-1">
        <h1 id="approvals-heading" className="font-display text-2xl font-semibold">
          Pending approvals
        </h1>
        <p className="text-muted-foreground text-sm">
          Review each submitted business. Approve to publish it, or request changes with a reason.
        </p>
      </header>

      <QueueFilterBar filters={filters} categories={categories} onChange={onFiltersChange} />

      {state === 'ready' && cards.length > 0 ? (
        <QueueSelectionHeader
          selectedIds={selection.selectedIds}
          pageIds={pageIds}
          state={selection.state}
          onToggleAll={selection.onToggleAll}
        />
      ) : null}

      {state === 'ready' && cards.length > 0 ? bulkActions : null}

      <QueueBody
        state={state}
        cards={cards}
        errorMessage={errorMessage}
        onRetry={onRetry}
        onAction={onAction}
        onViewDetails={onViewDetails}
        selection={selection}
        now={now}
        isFiltered={isFiltered}
      />

      {state === 'ready' ? <QueuePagination {...pagination} /> : null}
    </section>
  );
}
