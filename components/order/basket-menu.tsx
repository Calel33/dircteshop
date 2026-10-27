'use client';

import type { FunctionReturnType } from 'convex/server';
import { CircleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import {
  toSelections,
  toggleSelection,
  totalForSelection,
  type SelectionModel,
} from '@/components/profile/ordering-panel-helpers';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { validateOrderSelections } from '@/convex/orderPolicy';
import { createClientId, MAX_LINE_QUANTITY, type BasketLine } from '@/lib/basket';
import { ORDER_ERROR_COPY } from '@/lib/order-errors';
import { formatPrice } from '@/lib/order-format';
import { cn } from '@/lib/utils';

import { QuantityStepper } from './basket-controls';

export type MenuData = NonNullable<FunctionReturnType<typeof api.menus.listForBusiness>>;
export type MenuItem = MenuData['items'][number];
export type MenuGroup = MenuData['groups'][number];

export type MenuSection = { group: MenuGroup; items: MenuItem[] };

/** Groups keep the menu's order; a group with no items is omitted. */
export function groupMenu(data: MenuData): MenuSection[] {
  const itemsByGroup = new Map<string, MenuItem[]>();
  for (const item of data.items) {
    const bucket = itemsByGroup.get(item.groupId);
    if (bucket === undefined) {
      itemsByGroup.set(item.groupId, [item]);
    } else {
      bucket.push(item);
    }
  }

  return data.groups.flatMap((group) => {
    const items = itemsByGroup.get(group._id) ?? [];
    return items.length === 0 ? [] : [{ group, items }];
  });
}

function priceLabel(price: number | undefined): string {
  return price === undefined ? 'Price at pickup' : formatPrice(price);
}

function selectionErrorCopy(itemName: string): string {
  return ORDER_ERROR_COPY.SELECTION_INVALID.copy.replace('{item}', itemName);
}

/**
 * Item customizer in a focus-trapped dialog. Quantity is part of the line
 * (§6.7 "quantity stepper with text labels"), and required groups gate the Add
 * action so an invalid selection never enters the basket.
 */
function ItemCustomizerDialog({
  item,
  maxQuantity,
  disabled,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  maxQuantity: number;
  disabled: boolean;
  onAdd: (line: BasketLine) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [model, setModel] = useState<SelectionModel>({});
  const [quantity, setQuantity] = useState(1);
  const selections = toSelections(item.customizationOptions, model);
  const selectionError = validateOrderSelections(item.customizationOptions, selections);
  const unitTotal = totalForSelection(item, model);
  const effectiveQuantity = Math.min(quantity, Math.max(1, maxQuantity));

  function add() {
    if (selectionError !== null) {
      return;
    }
    onAdd({
      id: createClientId(),
      menuItemId: item._id,
      name: item.name,
      ...(unitTotal === null ? {} : { unitTotal }),
      quantity: effectiveQuantity,
      selections,
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent data-testid="item-customizer">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            {priceLabel(item.price)} · Choose the options for this line.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-gap overflow-y-auto pr-1">
          {item.description === undefined || item.description.length === 0 ? null : (
            <p className="text-tiny text-card-muted">{item.description}</p>
          )}

          {item.customizationOptions.length === 0 ? (
            <p className="text-micro text-card-muted">This item has no options.</p>
          ) : (
            item.customizationOptions.map((group, index) => {
              const groupId = `${id}-group-${index}`;
              const inputType = group.required ? 'radio' : 'checkbox';

              return (
                <fieldset key={groupId} className="border-border rounded-control flex flex-col gap-1 border p-2">
                  <legend className="px-1 text-tiny font-semibold">
                    {group.name}
                    <span className="text-micro text-card-muted font-normal">
                      {group.required ? ' · Required, pick one' : ' · Optional, pick any'}
                    </span>
                  </legend>
                  {group.options.map((option, optionIndex) => {
                    const optionId = `${groupId}-option-${optionIndex}`;
                    const selected = (model[group.name] ?? []).includes(option.name);

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
                            name={groupId}
                            value={option.name}
                            checked={selected}
                            onChange={() =>
                              setModel((current) => toggleSelection(current, group, option.name))
                            }
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
              );
            })
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-tiny font-semibold">Quantity</span>
            <QuantityStepper
              value={effectiveQuantity}
              label={item.name}
              max={Math.max(1, maxQuantity)}
              onChange={setQuantity}
            />
          </div>

          {selectionError === null ? null : (
            <p role="alert" className="text-micro text-danger-strong flex items-start gap-1.5">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {selectionErrorCopy(item.name)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={disabled || selectionError !== null || maxQuantity < 1}
            onClick={add}
          >
            {unitTotal === null
              ? 'Add to basket'
              : `Add to basket — ${formatPrice(unitTotal * effectiveQuantity)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The compact public menu the basket is composed from. Group availability and
 * item availability are rendered, never merely disabled silently: §6.7 wants
 * the customer to know why an item cannot be added.
 */
export function BasketMenu({
  data,
  paused,
  atCapacity,
  remainingUnits,
  onAdd,
}: {
  data: MenuData;
  paused: boolean;
  atCapacity: boolean;
  remainingUnits: number;
  onAdd: (line: BasketLine) => void;
}) {
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const sections = groupMenu(data);
  const maxQuantity = Math.min(MAX_LINE_QUANTITY, Math.max(0, remainingUnits));

  return (
    <div className="flex flex-col gap-gap">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-tiny font-semibold">Menu</h3>
        <p className="text-micro text-card-muted">
          Add items with their options and quantity. Prices come from the business&apos;s current
          menu.
        </p>
      </div>

      {atCapacity ? (
        <p role="status" className="border-warning-border bg-warning-soft text-warning-strong rounded-control border p-3 text-tiny">
          This order has reached the online limit. Call the business to add more.
        </p>
      ) : null}

      {sections.map(({ group, items }) => (
        <section
          key={group._id}
          aria-labelledby={`basket-group-${group._id}`}
          className="flex flex-col gap-2"
        >
          <h4 id={`basket-group-${group._id}`} className="text-tiny font-semibold">
            {group.name}
          </h4>
          {group.isAvailable ? null : (
            <p className="border-warning-border bg-warning-soft text-warning-strong rounded-control border p-2 text-micro">
              This section is unavailable right now.
            </p>
          )}
          <ul role="list" className="flex flex-col gap-2">
            {items.map((item) => {
              const unavailable = !item.isAvailable || !group.isAvailable;
              const disabled = unavailable || paused || atCapacity;

              return (
                <li
                  key={item._id}
                  className={cn(
                    'border-border flex flex-col gap-2 rounded-control border p-3',
                    unavailable ? 'opacity-80' : ''
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-tiny font-semibold">{item.name}</p>
                      <p className="text-micro text-card-muted">{priceLabel(item.price)}</p>
                    </div>
                    {item.isAvailable ? null : (
                      <span className="border-danger-border bg-danger-soft text-danger-strong rounded-pill border px-2 py-0.5 text-micro font-semibold">
                        Sold out
                      </span>
                    )}
                  </div>
                  {item.description === undefined || item.description.length === 0 ? null : (
                    <p className="text-micro text-card-muted">{item.description}</p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={disabled ? 'outline' : 'default'}
                    className="min-h-11 self-start"
                    disabled={disabled}
                    aria-label={`Add ${item.name} to your basket`}
                    onClick={() => setActiveItem(item)}
                  >
                    {item.customizationOptions.length === 0 ? 'Add' : 'Choose options'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {activeItem === null ? null : (
        <ItemCustomizerDialog
          key={activeItem._id}
          item={activeItem}
          maxQuantity={maxQuantity}
          disabled={paused || atCapacity}
          onAdd={(line) => {
            onAdd(line);
            setActiveItem(null);
          }}
          onClose={() => setActiveItem(null)}
        />
      )}
    </div>
  );
}
