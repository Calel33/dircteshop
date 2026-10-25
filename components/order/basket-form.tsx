'use client';

import type { RefObject } from 'react';

import {
  MAX_CONTACT_LENGTH,
  MAX_CUSTOMER_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  type OrderFormValues,
} from '@/components/profile/ordering-panel-helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * One details form for the whole order (§6.7 "enter details once"). Purely
 * presentational: the panel owns validation, submission, and error focus.
 */
export function BasketDetailsForm({
  form,
  isSubmitting,
  disabled,
  canSubmit,
  headingRef,
  onChange,
  onSubmit,
}: {
  form: OrderFormValues;
  isSubmitting: boolean;
  disabled: boolean;
  canSubmit: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onChange: (patch: Partial<OrderFormValues>) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      noValidate
      aria-busy={isSubmitting}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="border-border flex flex-col gap-gap border-t pt-gap"
    >
      <div className="flex flex-col gap-0.5">
        <h3 ref={headingRef} tabIndex={-1} className="text-tiny font-semibold outline-none">
          Your details
        </h3>
        <p className="text-micro text-card-muted">
          No account needed — the business uses these to confirm your order.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-gap @max-[60rem]:grid-cols-1">
        <div className="col-span-2 flex flex-col gap-1 @max-[60rem]:col-span-1">
          <Label htmlFor="basket-name">Name</Label>
          <Input
            id="basket-name"
            name="name"
            autoComplete="name"
            required
            maxLength={MAX_CUSTOMER_NAME_LENGTH}
            value={form.customerName}
            disabled={isSubmitting}
            onChange={(event) => onChange({ customerName: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="basket-phone">Phone</Label>
          <Input
            id="basket-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={MAX_CONTACT_LENGTH}
            value={form.contactPhone}
            disabled={isSubmitting}
            onChange={(event) => onChange({ contactPhone: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="basket-email">Email</Label>
          <Input
            id="basket-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={MAX_CONTACT_LENGTH}
            value={form.contactEmail}
            disabled={isSubmitting}
            onChange={(event) => onChange({ contactEmail: event.target.value })}
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1 @max-[60rem]:col-span-1">
          <Label htmlFor="basket-note">
            Note <span className="text-card-muted font-normal">(optional)</span>
          </Label>
          <Textarea
            id="basket-note"
            name="note"
            rows={3}
            maxLength={MAX_NOTE_LENGTH}
            value={form.note}
            disabled={isSubmitting}
            onChange={(event) => onChange({ note: event.target.value })}
            placeholder="Allergies, pickup details, or anything else the business should know"
          />
        </div>
      </div>
      <p className="text-micro text-card-muted">
        Include a phone number or email so the business can confirm your order. Sending does not
        charge you; payment is arranged directly with the business.
      </p>
      <Button type="submit" className="min-h-11 w-full" disabled={isSubmitting || disabled || !canSubmit}>
        {isSubmitting ? 'Sending your order…' : 'Send order'}
      </Button>
    </form>
  );
}
