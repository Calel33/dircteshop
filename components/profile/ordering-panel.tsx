'use client';

import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { TriangleAlert } from 'lucide-react';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import {
  messageForError,
  resolveOrderHash,
  toSelections,
  toggleSelection,
  totalForSelection,
  validateOrderForm,
  type Confirmation,
  type OrderFormValues,
  type SelectionModel,
} from './ordering-panel-helpers';
import { Customizer, ItemList, OrderConfirmation } from './ordering-panel-sections';

/**
 * Public ordering panel (T5). Subscribes to the approved-only menu, listens for
 * the `#order` / `#order-<itemId>` hash contract from `ActionsBar` and
 * `MenuTabs`, then drives customize → anonymous form → submit → live status.
 *
 * Next 16 hash-only navigation does not remount the tree (`use-router.md:50`:
 * `bfcacheId` is unchanged for hash-only navigations), so the panel subscribes
 * to `hashchange` in addition to applying the hash when menu data first arrives.
 */

type MenuData = NonNullable<FunctionReturnType<typeof api.menus.listForBusiness>>;
type MenuItem = MenuData['items'][number];
type View = 'browse' | 'customize' | 'confirmation';

const EMPTY_FORM: OrderFormValues = {
  customerName: '',
  contactPhone: '',
  contactEmail: '',
  note: '',
};

/** Anchor the in-page contract owns; `scroll-mt-section` clears the sticky header. */
function PanelShell({ children }: { children: ReactNode }) {
  return (
    <section id="order" aria-label="Order online" className="@container scroll-mt-section">
      {children}
    </section>
  );
}

function OrderingPanelSkeleton() {
  return (
    <PanelShell>
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
    </PanelShell>
  );
}

function OrderingPanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <PanelShell>
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
    </PanelShell>
  );
}

class OrderingPanelErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <OrderingPanelError onRetry={this.props.onRetry} />;
    }

    return this.props.children;
  }
}

function OrderingPanelQuery({ businessId }: { businessId: Id<'businesses'> }) {
  const data = useQuery(api.menus.listForBusiness, { businessId });

  if (data === undefined) {
    return <OrderingPanelSkeleton />;
  }

  // `null` is the approved-only gate; an empty menu renders no module at all.
  if (data === null || data.items.length === 0) {
    return null;
  }

  return <OrderingPanelBody businessId={businessId} items={data.items} />;
}

function OrderingPanelBody({
  businessId,
  items,
}: {
  businessId: Id<'businesses'>;
  items: MenuItem[];
}) {
  const submitOrder = useMutation(api.orders.submitOrder);
  const [view, setView] = useState<View>('browse');
  const [activeItemId, setActiveItemId] = useState<Id<'menuItems'> | null>(null);
  const [model, setModel] = useState<SelectionModel>({});
  const [form, setForm] = useState<OrderFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const itemsRef = useRef<readonly MenuItem[]>(items);
  const viewRef = useRef<View>(view);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Reads the live ref, never a captured list: a menu update must not reopen
  // (and therefore reset) the customizer the visitor is filling in.
  const openFromHash = useCallback(() => {
    const resolution = resolveOrderHash(itemsRef.current, window.location.hash);

    if (resolution.kind === 'unavailable') {
      if (viewRef.current === 'confirmation') {
        return;
      }
      setView('browse');
      setActiveItemId(null);
      setNotice('That item is currently unavailable. Choose another item or call the business.');
      return;
    }

    if (resolution.kind === 'idle') {
      if (viewRef.current === 'confirmation') {
        return;
      }
      setView('browse');
      setActiveItemId(null);
      setNotice(null);
      return;
    }

    setActiveItemId(resolution.item._id);
    setModel({});
    setForm(EMPTY_FORM);
    setFormError(null);
    setSubmitError(null);
    setNotice(null);
    setView('customize');
    setFocusSignal((current) => current + 1);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      document
        .getElementById('order')
        ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }, []);

  useEffect(() => {
    const onHashChange = () => openFromHash();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [openFromHash]);

  // The body mounts once menu data exists, so the initial hash is applied here
  // instead of during the loading skeleton.
  const appliedInitialHash = useRef(false);
  useEffect(() => {
    if (appliedInitialHash.current) {
      return;
    }
    appliedInitialHash.current = true;
    openFromHash();
  }, [openFromHash]);

  const resetToBrowse = useCallback(() => {
    setView('browse');
    setActiveItemId(null);
    setModel({});
    setForm(EMPTY_FORM);
    setFormError(null);
    setSubmitError(null);
    setNotice(null);
    setConfirmation(null);

    if (window.location.hash.startsWith('#order')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, []);

  const activeItem =
    activeItemId === null ? null : (items.find((item) => item._id === activeItemId) ?? null);

  async function handleSubmit() {
    // Guards a second Enter-key submit before the disabled state paints.
    if (isSubmitting || activeItem === null || !activeItem.isAvailable) {
      return;
    }

    const validationError = validateOrderForm(activeItem, model, form);
    if (validationError !== null) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const selections = toSelections(activeItem.customizationOptions, model);
      const customerName = form.customerName.trim();
      const contactPhone = form.contactPhone.trim();
      const contactEmail = form.contactEmail.trim();
      const note = form.note.trim();

      const orderId = await submitOrder({
        businessId,
        menuItemId: activeItem._id,
        selections,
        customerName,
        ...(contactPhone.length === 0 ? {} : { contactPhone }),
        ...(contactEmail.length === 0 ? {} : { contactEmail }),
        ...(note.length === 0 ? {} : { note }),
      });

      setConfirmation({
        orderId,
        itemName: activeItem.name,
        selections,
        total: totalForSelection(activeItem, model),
      });
      setView('confirmation');
    } catch (error) {
      setSubmitError(messageForError(error, 'Could not place the order. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PanelShell>
      <Card>
        <CardHeader>
          <h2 className="text-body leading-none font-semibold">Order online</h2>
          <p className="text-tiny text-card-muted">
            Customize an item and send your order — no account needed.
          </p>
        </CardHeader>
        <CardContent>
          {view === 'confirmation' && confirmation !== null ? (
            <OrderConfirmation confirmation={confirmation} onReset={resetToBrowse} />
          ) : view === 'customize' && activeItem !== null ? (
            <Customizer
              key={activeItem._id}
              item={activeItem}
              model={model}
              form={form}
              formError={formError}
              submitError={submitError}
              isSubmitting={isSubmitting}
              focusSignal={focusSignal}
              onBack={resetToBrowse}
              onToggleOption={(group, choiceName) =>
                setModel((current) => toggleSelection(current, group, choiceName))
              }
              onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              onSubmit={handleSubmit}
            />
          ) : (
            <ItemList items={items} notice={notice} />
          )}
        </CardContent>
      </Card>
    </PanelShell>
  );
}

/**
 * Frozen contract: `{ businessId }` only, `'use client'`. The retry key remounts
 * the subtree so a failed query re-subscribes (Convex `useQuery` throws during
 * render); the boundary is local presentation, not a data-flow contract.
 */
export function OrderingPanel({ businessId }: { businessId: Id<'businesses'> }) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <OrderingPanelErrorBoundary
      key={retryKey}
      onRetry={() => setRetryKey((current) => current + 1)}
    >
      <OrderingPanelQuery businessId={businessId} />
    </OrderingPanelErrorBoundary>
  );
}
