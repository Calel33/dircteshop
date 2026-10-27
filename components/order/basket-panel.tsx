'use client';

import { useMutation, useQuery } from 'convex/react';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Component, useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import {
  MAX_NOTE_LENGTH,
  type OrderFormValues,
} from '@/components/profile/ordering-panel-helpers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { RejectionCode } from '@/convex/orderCommitPolicy';
import { validateOrderContact } from '@/convex/orderPolicy';
import {
  EMPTY_BASKET,
  MAX_BASKET_LINES,
  MAX_BASKET_UNITS,
  basketReducer,
  basketSubtotal,
  basketTotalUnits,
  browserStorage,
  clearStoredBasket,
  createClientId,
  loadBasket,
  saveBasket,
  type BasketLine,
  type BasketStorage,
} from '@/lib/basket';
import {
  ORDER_ERROR_COPY,
  resolveOrderError,
  type ResolvedOrderError,
} from '@/lib/order-errors';

import { BasketDetailsForm } from './basket-form';
import { OrderErrorSummary, OrderingPausedBanner } from './basket-controls';
import { BasketMenu, type MenuData } from './basket-menu';
import { BasketLines, BasketTotals, MobileBasketBar, RestoredBasketNote } from './basket-summary';

/**
 * Basket ordering panel (T8, issue #80). Rendered instead of the legacy
 * `OrderingPanel` when `businesses.orderProtocol === 'basket'`.
 *
 * Composition state lives in the pure reducer from `lib/basket.ts`; this
 * component owns only the side effects: hydration/persistence, the commit
 * mutation, focus, and navigation to the durable receipt.
 *
 * Docs: https://docs.convex.dev/client/react (useMutation/useQuery)
 */

const EMPTY_FORM: OrderFormValues = {
  customerName: '',
  contactPhone: '',
  contactEmail: '',
  note: '',
};

type PriceChange = { previousSubtotal: number | null; actualSubtotal: number };

/**
 * `resolveOrderError` code → reported rejection code (issue #84, T10 / plan D4).
 *
 * A rejection cannot be counted where it happens — the handler throws and its
 * writes roll back — so the client is the only observer and reports it through
 * `orderMetrics.recordOrderRejection`. Only codes that back a §4.4 rate are
 * reported; `GROUP_UNAVAILABLE`, `PRICE_UNAVAILABLE`, `ORDER_VALUE_TOO_HIGH`,
 * `CONTACT_INVALID`, `IDEMPOTENCY_CONFLICT`, `NETWORK`, and the rest are not in
 * `REJECTION_CODES` and are deliberately silent.
 *
 * `ORDER_NOT_ACCEPTED` is the block list's refusal (`convex/orderThrottle.ts`
 * `assertContactNotBlocked`); `TOO_MANY_REQUESTS` is either throttle window.
 * The load-test harness reproduces this exact mapping for its self-reporting.
 */
const REJECTION_CODE_BY_ORDER_ERROR: Partial<
  Record<ResolvedOrderError['code'], RejectionCode>
> = {
  TOO_MANY_REQUESTS: 'throttle_rejected',
  ORDER_NOT_ACCEPTED: 'block_hit',
  PRICE_CHANGED: 'price_changed',
  ITEM_UNAVAILABLE: 'item_unavailable',
  ORDERING_CLOSED: 'ordering_closed',
  OUTSIDE_HOURS: 'outside_hours',
};

function BasketPanelShell({ children }: { children: ReactNode }) {
  return (
    <section id="order" aria-label="Order online" className="@container scroll-mt-section">
      {children}
    </section>
  );
}

function BasketPanelSkeleton() {
  return (
    <BasketPanelShell>
      <Card role="status" aria-busy="true" aria-label="Loading ordering">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-gap">
          <Skeleton className="h-4 w-3/4" />
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 w-full rounded-control" />
          ))}
        </CardContent>
      </Card>
    </BasketPanelShell>
  );
}

function BasketPanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <BasketPanelShell>
      <Card role="alert" className="items-center gap-gap border-dashed px-card py-card text-center">
        <TriangleAlert aria-hidden className="text-card-muted size-10 stroke-[1.5]" />
        <div className="flex flex-col gap-1">
          <p className="text-body font-semibold">Ordering unavailable</p>
          <p className="text-tiny text-card-muted">
            Something went wrong while loading ordering. Nothing was submitted — try again.
          </p>
        </div>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </Card>
    </BasketPanelShell>
  );
}

class BasketPanelErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <BasketPanelError onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

function BasketPanelQuery({
  businessId,
  businessName,
  phone,
  acceptingOrders,
  acceptingOrdersUntil,
}: BasketPanelProps) {
  const data = useQuery(api.menus.listForBusiness, { businessId });

  if (data === undefined) {
    return <BasketPanelSkeleton />;
  }

  if (data === null || data.items.length === 0) {
    return (
      <BasketPanelShell>
        <Card>
          <CardHeader>
            <h2 className="text-body leading-none font-semibold">Order online</h2>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-tiny">{ORDER_ERROR_COPY.MENU_EMPTY.copy}</p>
            {phone === undefined || phone.length === 0 ? null : (
              <a className="text-tiny underline underline-offset-2" href={`tel:${phone}`}>
                Call {businessName}
              </a>
            )}
          </CardContent>
        </Card>
      </BasketPanelShell>
    );
  }

  return (
    <BasketPanelBody
      businessId={businessId}
      businessName={businessName}
      phone={phone}
      acceptingOrders={acceptingOrders}
      acceptingOrdersUntil={acceptingOrdersUntil}
      data={data}
    />
  );
}

function BasketPanelBody({
  businessId,
  businessName,
  phone,
  acceptingOrders,
  acceptingOrdersUntil,
  data,
}: BasketPanelProps & { data: MenuData }) {
  const placeOrder = useMutation(api.orders.placeOrder);
  const recordOrderRejection = useMutation(api.orderMetrics.recordOrderRejection);
  const router = useRouter();
  const [basket, dispatch] = useReducer(basketReducer, EMPTY_BASKET);
  const [storage, setStorage] = useState<BasketStorage | null>(null);
  const [ready, setReady] = useState(false);
  const [submitKey, setSubmitKey] = useState(createClientId);
  const [form, setForm] = useState<OrderFormValues>(EMPTY_FORM);
  const [error, setError] = useState<ResolvedOrderError | null>(null);
  const [priceChange, setPriceChange] = useState<PriceChange | null>(null);
  const [closed, setClosed] = useState<ResolvedOrderError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const errorRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLHeadingElement>(null);
  const signatureRef = useRef<string | null>(null);
  const reportedRejectionRef = useRef<string | null>(null);

  const pausedByFlag =
    !acceptingOrders ||
    (acceptingOrdersUntil !== undefined && acceptingOrdersUntil <= Date.now());
  const paused = pausedByFlag || closed !== null;
  const pausedCopy =
    closed?.copy ??
    (phone === undefined || phone.length === 0
      ? 'Ordering is paused right now.'
      : `Ordering is paused. Call ${phone} to order.`);
  const remainingUnits = MAX_BASKET_UNITS - basketTotalUnits(basket.lines);
  const atCapacity = basket.lines.length >= MAX_BASKET_LINES || remainingUnits < 1;

  // Hydrate once per business from the versioned payload. Storage failing is
  // not an order failure: the reducer keeps working in memory.
  useEffect(() => {
    const store = browserStorage();
    setStorage(store);
    const loaded = loadBasket(store, businessId);
    if (loaded !== null) {
      dispatch({ type: 'hydrate', lines: loaded.lines });
      if (loaded.submitKey !== null) {
        setSubmitKey(loaded.submitKey);
      }
    }
    setReady(true);
  }, [businessId]);

  // Persist basket-only data: line snapshots plus the idempotency key. The
  // customer's name/phone/email/note never reach storage (§6.7).
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (basket.lines.length === 0) {
      clearStoredBasket(storage, businessId);
      return;
    }
    saveBasket(storage, businessId, basket.lines, submitKey);
  }, [ready, basket.lines, submitKey, storage, businessId]);

  // Same key for the same args (two tabs, a retry); a changed basket or form
  // rotates it so it can never collide with a different payload.
  const signature = JSON.stringify({
    lines: basket.lines.map((line) => [line.menuItemId, line.quantity, line.selections]),
    form,
  });
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (signatureRef.current === null) {
      signatureRef.current = signature;
      return;
    }
    if (signatureRef.current === signature) {
      return;
    }
    signatureRef.current = signature;
    setSubmitKey(createClientId());
  }, [ready, signature]);

  // Focus-to-error on every failure (§6.7 accessibility).
  useEffect(() => {
    if (error !== null) {
      errorRef.current?.focus();
    }
  }, [error]);

  const refresh = useCallback(() => {
    setError(null);
    setPriceChange(null);
    router.refresh();
  }, [router]);

  function handleAdd(line: BasketLine) {
    dispatch({ type: 'add', line });
    setAnnouncement(`Added ${line.name} to your basket.`);
  }

  function handleRemove(lineId: string) {
    const name = basket.lines.find((line) => line.id === lineId)?.name;
    dispatch({ type: 'remove', lineId });
    setAnnouncement(name === undefined ? 'Removed an item.' : `Removed ${name} from your basket.`);
  }

  function handleClear() {
    dispatch({ type: 'clear' });
    clearStoredBasket(storage, businessId);
    setAnnouncement('Basket cleared.');
  }

  function validate(): ResolvedOrderError | null {
    if (basket.lines.length === 0) {
      return copyError('BASKET_EMPTY');
    }
    if (validateOrderContact({ customerName: form.customerName, contactPhone: form.contactPhone, contactEmail: form.contactEmail }) !== null) {
      return copyError('CONTACT_INVALID');
    }
    if (form.note.trim().length > MAX_NOTE_LENGTH) {
      return copyError('NOTE_TOO_LONG');
    }
    return null;
  }

  /**
   * Fire-and-forget rejection report (§4.4 counters, plan D4).
   *
   * Exactly once per failed attempt: the signature is the submit key plus the
   * code, and the submit key only rotates when the basket or form changes, so
   * pressing Submit again on an unchanged failure cannot double-count.
   *
   * The beacon must never compete with the order error the customer is reading:
   * its own rejection is swallowed, and the order error is applied regardless.
   */
  function reportRejection(code: ResolvedOrderError['code'], attemptKey: string) {
    const rejection = REJECTION_CODE_BY_ORDER_ERROR[code];
    if (rejection === undefined) {
      return;
    }
    const signature = `${attemptKey}:${rejection}`;
    if (reportedRejectionRef.current === signature) {
      return;
    }
    reportedRejectionRef.current = signature;
    void recordOrderRejection({ businessId, code: rejection }).catch(() => {});
  }

  function applySubmitError(resolved: ResolvedOrderError, expectedSubtotal: number | null) {
    // A pause or closed hours is not a basket error: it is a browse-only
    // state with the business's phone, so the panel banner owns the copy.
    if (resolved.code === 'ORDERING_CLOSED' || resolved.code === 'OUTSIDE_HOURS') {
      setClosed(resolved);
      setAnnouncement(resolved.copy);
      return;
    }

    if (resolved.code === 'PRICE_CHANGED' && resolved.actualSubtotal !== undefined) {
      setPriceChange({
        previousSubtotal: expectedSubtotal,
        actualSubtotal: resolved.actualSubtotal,
      });
    }

    if (
      (resolved.code === 'ITEM_UNAVAILABLE' || resolved.code === 'GROUP_UNAVAILABLE') &&
      resolved.lineIndex !== undefined
    ) {
      const line = basket.lines[resolved.lineIndex];
      if (line !== undefined) {
        dispatch({ type: 'markUnavailable', lineIds: [line.id] });
      }
    }

    setError(resolved);
    setAnnouncement('Your order was not sent.');
  }

  async function send(expectedSubtotal: number | null, key: string) {
    setIsSubmitting(true);
    setError(null);
    setAnnouncement('Sending your order…');

    try {
      const customerName = form.customerName.trim();
      const contactPhone = form.contactPhone.trim();
      const contactEmail = form.contactEmail.trim();
      const note = form.note.trim();
      const receipt = await placeOrder({
        businessId,
        lines: basket.lines.map((line) => ({
          menuItemId: line.menuItemId as Id<'menuItems'>,
          quantity: line.quantity,
          selections: line.selections,
        })),
        customerName,
        ...(contactPhone.length === 0 ? {} : { contactPhone }),
        ...(contactEmail.length === 0 ? {} : { contactEmail }),
        ...(note.length === 0 ? {} : { note }),
        expectedSubtotal,
        idempotencyKey: key,
      });

      clearStoredBasket(storage, businessId);
      dispatch({ type: 'clear' });
      setAnnouncement('Order sent. Opening your receipt…');
      router.push(`/order/${receipt.accessToken}`);
    } catch (caught) {
      const resolved = resolveOrderError(caught, { phone });
      reportRejection(resolved.code, key);
      applySubmitError(resolved, expectedSubtotal);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit() {
    if (isSubmitting || paused) {
      return;
    }
    const validation = validate();
    if (validation !== null) {
      setError(validation);
      return;
    }
    setPriceChange(null);
    const key = submitKey;
    void send(basketSubtotal(basket.lines), key);
  }

  function handleReconfirm() {
    if (priceChange === null || isSubmitting) {
      return;
    }
    // A new total is a new payload: rotate the key before sending again.
    const key = createClientId();
    setSubmitKey(key);
    void send(priceChange.actualSubtotal, key);
  }

  function reviewOrder() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    detailsRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    detailsRef.current?.focus({ preventScroll: true });
  }

  return (
    <BasketPanelShell>
      <Card>
        <CardHeader>
          <h2 className="text-body leading-none font-semibold">Order online</h2>
          <p className="text-tiny text-card-muted">
            Build a basket and send one order. Pickup only; no account needed.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-gap">
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>

          {paused ? (
            <OrderingPausedBanner
              copy={pausedCopy}
              businessName={businessName}
              phone={phone}
            />
          ) : null}

          {basket.restored ? (
            <RestoredBasketNote onDismiss={() => dispatch({ type: 'dismissRestored' })} />
          ) : null}

          {error === null ? null : (
            <OrderErrorSummary
              error={error}
              businessName={businessName}
              phone={phone}
              summaryRef={errorRef}
              isSubmitting={isSubmitting}
              priceChange={priceChange}
              onReconfirm={handleReconfirm}
              onRefresh={refresh}
            />
          )}

          <BasketMenu
            data={data}
            paused={paused}
            atCapacity={atCapacity}
            remainingUnits={remainingUnits}
            onAdd={handleAdd}
          />

          <div className="flex flex-col gap-2 border-t pt-gap">
            <h3 className="text-tiny font-semibold">Your basket</h3>
            <BasketLines
              lines={basket.lines}
              unavailableLineIds={basket.unavailableLineIds}
              disabled={isSubmitting}
              onQuantity={(lineId, quantity) =>
                dispatch({ type: 'setQuantity', lineId, quantity })
              }
              onRemove={handleRemove}
            />
            <BasketTotals
              lines={basket.lines}
              subtotal={basketSubtotal(basket.lines)}
              disabled={isSubmitting}
              onClear={handleClear}
            />
          </div>

          <BasketDetailsForm
            form={form}
            isSubmitting={isSubmitting}
            disabled={paused}
            canSubmit={basket.lines.length > 0}
            headingRef={detailsRef}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onSubmit={handleSubmit}
          />

          <MobileBasketBar
            subtotal={basketSubtotal(basket.lines)}
            itemCount={basket.lines.length}
            onReview={reviewOrder}
          />
        </CardContent>
      </Card>
    </BasketPanelShell>
  );
}

function copyError(code: keyof typeof ORDER_ERROR_COPY): ResolvedOrderError {
  const entry = ORDER_ERROR_COPY[code];
  return {
    code,
    copy: entry.copy,
    recoveryAction: entry.recoveryAction,
    recovery: entry.recovery,
  };
}

export type BasketPanelProps = {
  businessId: Id<'businesses'>;
  businessName: string;
  phone?: string;
  /** Schema default is accepting; `getPublic` normalizes it. */
  acceptingOrders: boolean;
  acceptingOrdersUntil?: number;
};

/**
 * Frozen entry point for the public profile: a bounded local error boundary,
 * same retry contract as the legacy panel.
 */
export function BasketPanel(props: BasketPanelProps) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <BasketPanelErrorBoundary
      key={retryKey}
      onRetry={() => setRetryKey((current) => current + 1)}
    >
      <BasketPanelQuery {...props} />
    </BasketPanelErrorBoundary>
  );
}
