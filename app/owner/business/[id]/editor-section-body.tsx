'use client';

import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { EditorHistory } from './editor-history';
import {
  ANALYTICS_SECTION,
  HISTORY_SECTION,
  MENU_SECTION,
  ORDERS_SECTION,
  PHOTOS_SECTION,
  SETTINGS_SECTION,
  type EditorSectionId,
} from './editor-sections';
import { MenuPanel } from './menu-panel';
import { OrdersPanel } from './orders-panel';
import { PhotosPanel } from './photos-panel';
import type { EditorSection } from './editor-types';
import type { EditorFormState } from './editor-form';
import type { HistoryEntry } from './editor-status';
import { EditorSectionView } from './section-editors';
import type { CategoryOption } from './section-card';

const STUB_NOTE_CLASS =
  'bg-muted text-muted-foreground rounded-control border border-border p-4 text-sm';

/** One live overview from `api.orderMetrics.overview` (contract: `convex/orderMetrics.ts`). */
type MetricsOverview = FunctionReturnType<typeof api.orderMetrics.overview>;

/** Placeholder for a value the window did not produce (never a fabricated `0`). */
const NO_VALUE = '—';

/**
 * Bucket labels mirror the `BASKET_*_BUCKETS` consts in `convex/orderMetrics.ts`.
 * They are not imported: that module imports the Convex server runtime, so it
 * cannot be pulled into a client component. The bucket `key` is the contract.
 */
const BASKET_LINE_LABELS: Readonly<Record<string, string>> = {
  '1': '1 line',
  '2': '2 lines',
  '3-4': '3-4 lines',
  '5+': '5+ lines',
  unknown: 'Unknown',
};

const BASKET_UNIT_LABELS: Readonly<Record<string, string>> = {
  '1': '1 unit',
  '2-3': '2-3 units',
  '4-6': '4-6 units',
  '7+': '7+ units',
  unknown: 'Unknown',
};

const BASKET_SUBTOTAL_LABELS: Readonly<Record<string, string>> = {
  'lt-1000': 'Under 1000 cents',
  '1000-2499': '1000-2499 cents',
  '2500-4999': '2500-4999 cents',
  'gte-5000': '5000+ cents',
  unpriced: 'Unpriced',
};

function formatCount(value: number): string {
  return value.toLocaleString();
}

/** Rates arrive as fractions (`0.05` = 5%); no submissions means no denominator. */
function formatRate(fraction: number, hasDenominator: boolean): string {
  if (!hasDenominator) {
    return NO_VALUE;
  }
  return `${(fraction * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

/** `perThousandSubmissions` is already multiplied by 1,000. */
function formatPerThousand(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** Latency arrives in milliseconds; the contract uses `null` for "no sample". */
function formatLatency(value: number | null): string {
  if (value === null) {
    return NO_VALUE;
  }
  if (value < 60_000) {
    return `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** `throttle_rejected` -> `Throttle rejected`; the code stays recognisable. */
function formatRejectionCode(code: string): string {
  const words = code.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `''` is the contract's bucket for an event that carried no reason. */
function formatDeclineReason(reason: string): string {
  return reason.length === 0 ? 'No reason recorded' : reason;
}

/** One labelled stat; `<dt>`/`<dd>` keeps the label associated with its value. */
function AnalyticsStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-muted border-border rounded-control border p-4 text-center">
      <dt className="text-muted-foreground text-xs font-semibold">{label}</dt>
      <dd className="text-foreground block text-2xl font-semibold">{value}</dd>
      {hint === undefined ? null : <dd className="text-muted-foreground text-xs">{hint}</dd>}
    </div>
  );
}

function AnalyticsStats({ overview }: { overview: MetricsOverview }) {
  const hasSubmissions = overview.submissions > 0;
  const samples = overview.latency.sampleSize;

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
        <AnalyticsStat label="Submissions" value={formatCount(overview.submissions)} />
        <AnalyticsStat label="Accepted latency p50" value={formatLatency(overview.latency.p50)} />
        <AnalyticsStat label="Accepted latency p95" value={formatLatency(overview.latency.p95)} />
        <AnalyticsStat
          label="Decline rate"
          value={formatRate(overview.declines.rate, hasSubmissions)}
          hint={`${formatCount(overview.declines.count)} declined`}
        />
        <AnalyticsStat
          label="Throttle hits"
          value={
            hasSubmissions
              ? `${formatPerThousand(overview.throttleHits.perThousandSubmissions)} / 1k`
              : NO_VALUE
          }
          hint={`${formatCount(overview.throttleHits.count)} reported`}
        />
        <AnalyticsStat
          label="Block hits"
          value={
            hasSubmissions
              ? `${formatPerThousand(overview.blockHits.perThousandSubmissions)} / 1k`
              : NO_VALUE
          }
          hint={`${formatCount(overview.blockHits.count)} reported`}
        />
        <AnalyticsStat
          label="Abuse rate"
          value={formatRate(overview.ownerFlags.abuseRate, hasSubmissions)}
          hint={`${formatCount(overview.ownerFlags.flaggedOrders)} flagged orders`}
        />
        <AnalyticsStat
          label="Receipt views"
          value={formatCount(overview.receiptViews)}
          hint="Client-reported"
        />
      </dl>
      <p className="text-muted-foreground text-sm">
        {samples === 0
          ? 'No accepted orders in this window, so latency has no value.'
          : `Latency covers ${formatCount(samples)} accepted ${samples === 1 ? 'order' : 'orders'}.`}
      </p>
    </div>
  );
}

function DeclineReasons({ declines }: { declines: MetricsOverview['declines'] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-foreground text-sm font-semibold">Decline reasons</h3>
      {declines.reasonMix.length === 0 ? (
        <p className="text-muted-foreground text-sm">No declines in this window.</p>
      ) : (
        <dl className="flex flex-col gap-1">
          {declines.reasonMix.map((entry) => (
            <div key={entry.reason} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground text-sm">{formatDeclineReason(entry.reason)}</dt>
              <dd className="text-foreground text-sm font-semibold">{formatCount(entry.count)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function RejectionRates({
  rates,
  hasSubmissions,
}: {
  rates: MetricsOverview['rejectionRates'];
  hasSubmissions: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-foreground text-sm font-semibold">Rejections by code</h3>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
        {rates.map((rate) => (
          <div key={rate.code} className="bg-muted rounded-control flex flex-col gap-1 p-2">
            <dt className="text-muted-foreground text-xs font-semibold">
              {formatRejectionCode(rate.code)}
            </dt>
            <dd className="text-foreground text-sm font-semibold">{formatCount(rate.count)}</dd>
            <dd className="text-muted-foreground text-xs">
              {hasSubmissions
                ? `${formatPerThousand(rate.perThousandSubmissions)} per 1,000`
                : NO_VALUE}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BasketBuckets({
  title,
  buckets,
  labels,
}: {
  title: string;
  buckets: MetricsOverview['basketSize']['byLineCount'];
  labels: Readonly<Record<string, string>>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-foreground text-sm font-semibold">{title}</h4>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
        {buckets.map((bucket) => (
          <div
            key={bucket.key}
            className="bg-muted rounded-control flex items-baseline justify-between gap-2 p-2"
          >
            <dt className="text-muted-foreground text-xs">{labels[bucket.key] ?? bucket.key}</dt>
            <dd className="text-foreground text-sm font-semibold">{formatCount(bucket.count)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BasketSize({ basketSize }: { basketSize: MetricsOverview['basketSize'] }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-foreground text-sm font-semibold">Basket size</h3>
      <p className="text-muted-foreground text-sm">
        {basketSize.orderCount === 0
          ? 'No orders read in this window, so every bucket is empty.'
          : `Taken over ${formatCount(basketSize.orderCount)} orders.`}
      </p>
      <BasketBuckets
        title="By lines"
        buckets={basketSize.byLineCount}
        labels={BASKET_LINE_LABELS}
      />
      <BasketBuckets
        title="By units"
        buckets={basketSize.byUnitCount}
        labels={BASKET_UNIT_LABELS}
      />
      <BasketBuckets
        title="By subtotal"
        buckets={basketSize.bySubtotalCents}
        labels={BASKET_SUBTOTAL_LABELS}
      />
    </section>
  );
}

function AnalyticsMetrics({ overview }: { overview: MetricsOverview }) {
  const hasSubmissions = overview.submissions > 0;

  return (
    <div className="flex flex-col gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {`Order analytics updated: ${formatCount(overview.submissions)} submissions in the last ${
          overview.windowDays
        } days${overview.capped ? '; a read cap was hit, so the figures are floors' : ''}.`}
      </p>
      <p className="text-muted-foreground text-sm">
        Rolling {overview.windowDays}-day window ending now.
      </p>
      {overview.capped ? (
        <p className="border-border bg-muted text-foreground rounded-control border p-4 text-sm">
          <span className="font-semibold">Partial window.</span> A read cap was hit, so every count
          and rate below is a floor, not a total.
        </p>
      ) : null}
      <AnalyticsStats overview={overview} />
      <DeclineReasons declines={overview.declines} />
      <RejectionRates rates={overview.rejectionRates} hasSubmissions={hasSubmissions} />
      <BasketSize basketSize={overview.basketSize} />
      <p className="text-muted-foreground text-xs">
        Rejections and receipt views are client-reported and may undercount. The order runbook
        carries the full caveat.
      </p>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading order analytics" className="flex flex-col gap-4">
      <div className="bg-muted rounded-control h-4 w-2/3 animate-pulse" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="bg-muted rounded-control h-20 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function AnalyticsErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="border-danger-border bg-danger-soft rounded-control flex flex-col items-start gap-2 border p-card"
    >
      <p className="text-danger-strong text-sm font-semibold">Couldn&apos;t load analytics.</p>
      <p className="text-danger-strong text-sm">
        Order metrics did not load. Check that you are signed in as this business&apos;s owner, then
        try again.
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * `useQuery` throws during render when the owner-gated read rejects, so the
 * panel needs a render boundary. The parent remounts it through `retryKey`,
 * which resubscribes the query instead of leaving a dead error card.
 */
class AnalyticsBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state: { hasError: boolean } = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <AnalyticsErrorState onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

function AnalyticsContent({ businessId }: { businessId: Id<'businesses'> }) {
  const overview = useQuery(api.orderMetrics.overview, { businessId });

  if (overview === undefined) {
    return <AnalyticsSkeleton />;
  }

  return <AnalyticsMetrics overview={overview} />;
}

/**
 * Owner analytics (issue #84, T10): order-protocol metrics for the business's
 * rolling window. The v1 placeholders (profile views, contact clicks,
 * orders/bookings) were instrumented nowhere and are replaced by this query.
 */
function AnalyticsPanel({
  section,
  businessId,
}: {
  section: EditorSection;
  businessId: Id<'businesses'>;
}) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg">
          {section.label}
        </CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AnalyticsBoundary key={retryKey} onRetry={() => setRetryKey((current) => current + 1)}>
          <AnalyticsContent businessId={businessId} />
        </AnalyticsBoundary>
      </CardContent>
    </Card>
  );
}

/** Settings panel (prototype L455-457): stub note only. */
function SettingsPanel({ section }: { section: EditorSection }) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className={STUB_NOTE_CLASS}>v1 stub — placeholder. Nothing to configure here yet.</p>
      </CardContent>
    </Card>
  );
}

/**
 * Renders the active section of the owner editor: the Change History trail, the
 * Photos & Media / Analytics / Settings panels, or the editable section view
 * with the prototype's "Reset Section" tool in its panel head (L375-378).
 * Extracted from `EditorShell` so the shell's render branching stays within the
 * repo's ESLint complexity guardrail.
 */
export function EditorSectionBody({
  activeId,
  activeSection,
  form,
  onChange,
  readOnly,
  categories,
  historyEntries,
  businessId,
  photos,
  savedPhotos,
  onPhotosChange,
  showResetSection,
  canResetSection,
  onResetSection,
}: {
  activeId: EditorSectionId;
  activeSection: EditorSection;
  form: EditorFormState;
  onChange: <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => void;
  readOnly: boolean;
  categories: CategoryOption[];
  historyEntries: HistoryEntry[];
  businessId: Id<'businesses'>;
  photos: EditorFormState['photos'];
  savedPhotos: EditorFormState['photos'];
  onPhotosChange: (photos: EditorFormState['photos']) => void;
  /** True when the active section has reset fields. */
  showResetSection: boolean;
  canResetSection: boolean;
  onResetSection: () => void;
}) {
  const [panelBusy, setPanelBusy] = useState(false);

  const resetTool = showResetSection ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onResetSection}
      disabled={!canResetSection || panelBusy}
    >
      Reset Section
    </Button>
  ) : null;

  if (activeId === HISTORY_SECTION.id) {
    return <EditorHistory entries={historyEntries} />;
  }

  if (activeId === PHOTOS_SECTION.id) {
    return (
      <PhotosPanel
        businessId={businessId}
        section={activeSection}
        photos={photos}
        savedPhotos={savedPhotos}
        onPhotosChange={onPhotosChange}
        onBusyChange={setPanelBusy}
        readOnly={readOnly}
        tool={resetTool}
      />
    );
  }

  if (activeId === ANALYTICS_SECTION.id) {
    return <AnalyticsPanel section={activeSection} businessId={businessId} />;
  }

  if (activeId === SETTINGS_SECTION.id) {
    return <SettingsPanel section={activeSection} />;
  }

  if (activeId === MENU_SECTION.id) {
    return <MenuPanel businessId={businessId} readOnly={readOnly} />;
  }

  if (activeId === ORDERS_SECTION.id) {
    return <OrdersPanel businessId={businessId} />;
  }

  return (
    <EditorSectionView
      sectionId={activeId}
      section={activeSection}
      form={form}
      onChange={onChange}
      readOnly={readOnly}
      categories={categories}
      tool={resetTool}
    />
  );
}
