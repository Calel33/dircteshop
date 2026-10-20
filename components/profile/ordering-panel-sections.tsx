'use client';

import { useQuery } from 'convex/react';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import type { OrderStatus } from '@/convex/orderPolicy';
import { cn } from '@/lib/utils';

import {
  MAX_CONTACT_LENGTH,
  MAX_CUSTOMER_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  adjustmentTotal,
  formatPrice,
  orderCode,
  totalForSelection,
  type Confirmation,
  type OrderFormValues,
  type OrderingItem,
  type SelectionModel,
} from './ordering-panel-helpers';

/**
 * Presentation for the public ordering panel: idle item list, inline
 * customizer, and the confirmation receipt with its live status stepper. All
 * state and mutation wiring lives in `ordering-panel.tsx`.
 */

const ORDER_STEPS: readonly { status: OrderStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'ready', label: 'Ready' },
  { status: 'completed', label: 'Completed' },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'New',
  accepted: 'Accepted',
  ready: 'Ready',
  completed: 'Completed',
};

const STATUS_PILL_CLASS: Record<OrderStatus, string> = {
  new: 'border-info-border bg-info-soft text-info-strong',
  accepted: 'border-warning-border bg-warning-soft text-warning-strong',
  ready: 'border-success-border bg-success-soft text-success-strong',
  completed: 'border-border bg-neutral-chip text-neutral-chip-foreground',
};

const ERROR_CLASS =
  'border-danger-border bg-danger-soft text-danger-strong rounded-control border p-3 text-tiny';

export function ItemList({
  items,
  notice,
}: {
  items: readonly OrderingItem[];
  notice: string | null;
}) {
  const available = items.filter((item) => item.isAvailable);

  return (
    <div className="flex flex-col gap-gap">
      <p className="text-tiny text-card-muted">
        Pick an item to customize. Prices and availability come from the business&apos;s current
        menu.
      </p>
      {notice === null ? null : (
        <p
          role="status"
          className="border-warning-border bg-warning-soft text-warning-strong rounded-control border p-3 text-tiny"
        >
          {notice}
        </p>
      )}
      {available.length === 0 ? (
        <p className="border-border bg-muted text-card-muted rounded-control border p-3 text-tiny">
          No items are available to order right now. Please check back later.
        </p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {available.map((item) => (
            <li
              key={item._id}
              className="border-border flex flex-row items-center justify-between gap-2 rounded-control border p-3 @max-[44rem]:flex-col @max-[44rem]:items-stretch"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-tiny font-semibold">{item.name}</span>
                <span className="text-micro text-card-muted">
                  {item.price === undefined ? 'Price at business' : formatPrice(item.price)}
                </span>
              </div>
              <Button asChild size="sm">
                <a href={`#order-${item._id}`}>Order</a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomizationGroupSection({
  group,
  selected,
  open,
  disabled,
  onToggleOpen,
  onToggleOption,
}: {
  group: OrderingItem['customizationOptions'][number];
  selected: readonly string[];
  open: boolean;
  disabled: boolean;
  onToggleOpen: () => void;
  onToggleOption: (choiceName: string) => void;
}) {
  const id = useId();
  const panelId = `${id}-panel`;
  // Required → radio (one choice); optional → checkbox (zero or more).
  const inputType = group.required ? 'radio' : 'checkbox';

  return (
    <div className="border-border rounded-control border">
      <button
        type="button"
        id={`${id}-header`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggleOpen}
        className="bg-muted flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-left"
      >
        <span className="text-tiny font-semibold">{group.name}</span>
        <span className="flex items-center gap-2">
          <span className="text-micro text-card-muted">
            {group.required ? 'Required · pick one' : 'Optional · pick any'}
          </span>
          <ChevronDown
            aria-hidden
            className={cn('size-4 transition-transform', open ? 'rotate-180' : '')}
          />
        </span>
      </button>
      <fieldset id={panelId} hidden={!open} className="flex flex-col gap-1 p-2">
        <legend className="sr-only">
          {group.name} — {group.required ? 'choose one' : 'choose any'}
        </legend>
        {group.options.map((option, index) => {
          const optionId = `${id}-option-${index}`;

          return (
            <label
              key={optionId}
              htmlFor={optionId}
              className="hover:bg-muted flex cursor-pointer items-center justify-between gap-2 rounded-control px-2 py-1.5"
            >
              <span className="flex items-center gap-2">
                <input
                  id={optionId}
                  type={inputType}
                  name={id}
                  value={option.name}
                  checked={selected.includes(option.name)}
                  disabled={disabled}
                  onChange={() => onToggleOption(option.name)}
                  className="accent-primary size-4"
                />
                <span className="text-tiny">{option.name}</span>
              </span>
              {option.priceAdjustment === undefined || option.priceAdjustment === 0 ? null : (
                <span className="text-micro text-card-muted font-mono">
                  +{formatPrice(option.priceAdjustment)}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

function PriceSummary({ item, model }: { item: OrderingItem; model: SelectionModel }) {
  const adjustments = adjustmentTotal(item, model);
  const total = totalForSelection(item, model);

  return (
    <div
      aria-live="polite"
      className="border-border bg-card sticky bottom-0 z-10 flex flex-col gap-0.5 rounded-control border p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-micro text-card-muted font-mono tracking-label uppercase">
          {total === null ? 'Options total' : 'Running total'}
        </span>
        <span className="font-mono text-body font-semibold">
          {formatPrice(total ?? adjustments)}
        </span>
      </div>
      {item.price !== undefined && adjustments > 0 ? (
        <p className="text-micro text-card-muted text-right">
          Base {formatPrice(item.price)} + options {formatPrice(adjustments)}
        </p>
      ) : null}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message === null ? null : (
    <p role="alert" className={ERROR_CLASS}>
      {message}
    </p>
  );
}

function SubmitButton({
  isSubmitting,
  unavailable,
  hasError,
}: {
  isSubmitting: boolean;
  unavailable: boolean;
  hasError: boolean;
}) {
  const label = isSubmitting ? 'Placing order…' : hasError ? 'Try again' : 'Place order';

  return (
    <Button type="submit" disabled={isSubmitting || unavailable} className="w-full">
      {label}
    </Button>
  );
}

export function Customizer({
  item,
  model,
  form,
  formError,
  submitError,
  isSubmitting,
  focusSignal,
  onBack,
  onToggleOption,
  onFormChange,
  onSubmit,
}: {
  item: OrderingItem;
  model: SelectionModel;
  form: OrderFormValues;
  formError: string | null;
  submitError: string | null;
  isSubmitting: boolean;
  focusSignal: number;
  onBack: () => void;
  onToggleOption: (group: OrderingItem['customizationOptions'][number], choiceName: string) => void;
  onFormChange: (patch: Partial<OrderFormValues>) => void;
  onSubmit: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [openGroup, setOpenGroup] = useState<number | null>(0);
  const groups = item.customizationOptions;
  const unavailable = !item.isAvailable;

  useEffect(() => {
    if (focusSignal > 0) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [focusSignal]);

  return (
    <div className="flex flex-col gap-gap">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 ref={headingRef} tabIndex={-1} className="text-body font-semibold outline-none">
            {item.name}
          </h3>
          <p className="text-micro text-card-muted">
            {item.price === undefined ? 'Price at business' : `Base ${formatPrice(item.price)}`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
      </div>
      {item.description === undefined || item.description.length === 0 ? null : (
        <p className="text-tiny text-card-muted">{item.description}</p>
      )}
      {unavailable ? (
        <p role="alert" className={ERROR_CLASS}>
          This item is currently unavailable. Choose another item or call the business.
        </p>
      ) : null}
      {groups.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-micro text-card-muted">
            Required groups take one choice; optional groups accept any number.
          </p>
          {groups.map((group, index) => (
            <CustomizationGroupSection
              key={`${group.name}-${index}`}
              group={group}
              selected={model[group.name] ?? []}
              open={openGroup === index}
              disabled={isSubmitting}
              onToggleOpen={() => setOpenGroup((current) => (current === index ? null : index))}
              onToggleOption={(choiceName) => onToggleOption(group, choiceName)}
            />
          ))}
        </div>
      )}
      <PriceSummary item={item} model={model} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="border-border flex flex-col gap-gap border-t pt-gap"
      >
        <div className="flex flex-col gap-0.5">
          <p className="text-tiny font-semibold">Your details</p>
          <p className="text-micro text-card-muted">
            No account needed — we pass these to the business.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-gap @max-[60rem]:grid-cols-1">
          <div className="col-span-2 flex flex-col gap-1 @max-[60rem]:col-span-1">
            <Label htmlFor="order-name">Name</Label>
            <Input
              id="order-name"
              name="name"
              autoComplete="name"
              required
              maxLength={MAX_CUSTOMER_NAME_LENGTH}
              value={form.customerName}
              disabled={isSubmitting}
              onChange={(event) => onFormChange({ customerName: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="order-phone">Phone</Label>
            <Input
              id="order-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={MAX_CONTACT_LENGTH}
              value={form.contactPhone}
              disabled={isSubmitting}
              onChange={(event) => onFormChange({ contactPhone: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="order-email">Email</Label>
            <Input
              id="order-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={MAX_CONTACT_LENGTH}
              value={form.contactEmail}
              disabled={isSubmitting}
              onChange={(event) => onFormChange({ contactEmail: event.target.value })}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1 @max-[60rem]:col-span-1">
            <Label htmlFor="order-note">
              Note <span className="text-card-muted font-normal">(optional)</span>
            </Label>
            <Textarea
              id="order-note"
              name="note"
              rows={3}
              maxLength={MAX_NOTE_LENGTH}
              value={form.note}
              disabled={isSubmitting}
              onChange={(event) => onFormChange({ note: event.target.value })}
              placeholder="Allergies, pickup details, or anything else the business should know"
            />
          </div>
        </div>
        <p className="text-micro text-card-muted">
          Include a phone number or email so the business can confirm your order.
        </p>
        <FormError message={formError} />
        <FormError message={submitError} />
        <SubmitButton
          isSubmitting={isSubmitting}
          unavailable={unavailable}
          hasError={submitError !== null}
        />
      </form>
    </div>
  );
}

export function OrderConfirmation({
  confirmation,
  onReset,
}: {
  confirmation: Confirmation;
  onReset: () => void;
}) {
  const statusData = useQuery(api.orders.getOrderStatus, { orderId: confirmation.orderId });
  const status = statusData === undefined || statusData === null ? null : statusData.status;
  const currentIndex =
    status === null ? -1 : ORDER_STEPS.findIndex((step) => step.status === status);

  return (
    <div className="flex flex-col gap-gap">
      <div className="flex flex-col gap-1">
        <p className="text-micro text-card-muted font-mono tracking-label uppercase">
          Order received
        </p>
        <p className="text-body font-semibold">Order #{orderCode(confirmation.orderId)}</p>
        <p className="text-tiny text-card-muted">
          Keep this code. The business will contact you using the details you provided.
        </p>
      </div>
      <div className="border-border bg-muted flex flex-col gap-2 rounded-control border p-3">
        <dl className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-tiny">
            <dt className="text-card-muted">Item</dt>
            <dd className="text-right font-medium">{confirmation.itemName}</dd>
          </div>
          {confirmation.selections.map((selection) => (
            <div
              key={`${selection.optionName}-${selection.choiceName}`}
              className="flex items-baseline justify-between gap-2 text-tiny"
            >
              <dt className="text-card-muted">{selection.optionName}</dt>
              <dd className="text-right">{selection.choiceName}</dd>
            </div>
          ))}
          <div className="border-border flex items-baseline justify-between gap-2 border-t pt-1.5 text-tiny">
            <dt className="text-card-muted">Total at order</dt>
            <dd className="text-right font-mono font-semibold">
              {confirmation.total === null ? 'Price not listed' : formatPrice(confirmation.total)}
            </dd>
          </div>
        </dl>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-tiny font-semibold">Status</p>
          {status === null ? null : (
            <span
              className={cn(
                'rounded-pill border px-2 py-0.5 text-micro font-semibold',
                STATUS_PILL_CLASS[status]
              )}
            >
              {STATUS_LABEL[status]}
            </span>
          )}
        </div>
        {statusData === undefined ? (
          <p className="text-micro text-card-muted">Checking status…</p>
        ) : statusData === null ? (
          <p className="text-micro text-card-muted">
            Status is unavailable right now. Keep your order code and contact the business.
          </p>
        ) : (
          <ol aria-label="Order status" className="grid grid-cols-4 gap-2 @max-[44rem]:grid-cols-2">
            {ORDER_STEPS.map((step, index) => {
              const reached = currentIndex >= index;
              const current = currentIndex === index;

              return (
                <li
                  key={step.status}
                  aria-current={current ? 'step' : undefined}
                  className="flex flex-col gap-1"
                >
                  <span
                    aria-hidden
                    className={cn('h-1.5 rounded-pill', reached ? 'bg-primary' : 'bg-border')}
                  />
                  <span
                    className={cn(
                      'text-micro font-mono tracking-label uppercase',
                      current ? 'text-foreground font-semibold' : 'text-card-muted'
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <Button type="button" variant="outline" onClick={onReset}>
        Place another order
      </Button>
    </div>
  );
}
