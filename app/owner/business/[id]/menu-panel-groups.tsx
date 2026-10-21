'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import type { Id } from '@/convex/_generated/dataModel';

import { formatPrice } from './menu-panel-helpers';
import type { MenuGroup, MenuItem, MoveDirection } from './menu-panel-helpers';
import { TextField } from './menu-panel-item-editor';

// Group management for the owner Menu panel: the group card (header actions,
// rename/delete confirms, item rows, editor slot, add-item affordance) and the
// new-group form. Mutation wiring stays in `menu-panel.tsx`.

export const NOTICE_CLASS =
  'bg-muted text-muted-foreground rounded-control border border-border p-4 text-sm';
const ERROR_CLASS =
  'border-danger-border bg-danger-soft text-danger-strong rounded-control border p-3 text-sm';
const AVAILABLE_CLASS =
  'border-success-border bg-success-soft text-success-strong rounded-pill border px-2 py-0.5 text-micro font-semibold';
const UNAVAILABLE_CLASS =
  'border-border bg-muted text-muted-foreground rounded-pill border px-2 py-0.5 text-micro font-semibold';

function ItemRow({
  item,
  position,
  count,
  readOnly,
  busyKey,
  groupId,
  onEdit,
  onMove,
  onDelete,
}: {
  item: MenuItem;
  position: number;
  count: number;
  readOnly: boolean;
  busyKey: string | null;
  groupId: Id<'menuGroups'>;
  onEdit: (item: MenuItem) => void;
  onMove: (groupId: Id<'menuGroups'>, item: MenuItem, direction: MoveDirection) => void;
  onDelete: (groupId: Id<'menuGroups'>, itemId: Id<'menuItems'>) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const busy = busyKey !== null;

  return (
    <li className="border-border rounded-control flex flex-col gap-2 border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="bg-muted border-border size-14 shrink-0 overflow-hidden rounded-control border">
          {item.imageUrl === null ? (
            <span className="text-card-muted flex size-full items-center justify-center text-micro">No image</span>
          ) : (
            <img src={item.imageUrl} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{item.name}</p>
          <span className="text-card-muted text-sm">{formatPrice(item.price)}</span>
          <span className={item.isAvailable ? AVAILABLE_CLASS : UNAVAILABLE_CLASS}>
            {item.isAvailable ? 'Available' : 'Unavailable'}
          </span>
        </div>
        {readOnly ? null : (
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" aria-label={`Move ${item.name} up`}
              disabled={busy || position === 1} onClick={() => onMove(groupId, item, 'up')}>
              <span aria-hidden="true">↑</span>
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label={`Move ${item.name} down`}
              disabled={busy || position === count} onClick={() => onMove(groupId, item, 'down')}>
              <span aria-hidden="true">↓</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Edit ${item.name}`}
              disabled={busy}
              onClick={() => onEdit(item)}
            >
              Edit
            </Button>
            <Button type="button" variant="outline" size="icon" className="text-destructive"
              aria-label={`Delete ${item.name}`} disabled={busy} onClick={() => setConfirming(true)}>
              <span aria-hidden="true">✕</span>
            </Button>
          </div>
        )}
      </div>
      {confirming ? (
        <InlineConfirm
          message="Delete this menu item? This cannot be undone and it disappears from the public menu."
          confirmLabel="Delete item"
          destructive
          isPending={busyKey === `item:${item._id}:delete`}
          onConfirm={async () => {
            if (await onDelete(groupId, item._id)) setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </li>
  );
}

function GroupActions({
  group,
  position,
  groupCount,
  busy,
  onStartRename,
  onMove,
  onDelete,
}: {
  group: MenuGroup;
  position: number;
  groupCount: number;
  busy: boolean;
  onStartRename: () => void;
  onMove: (group: MenuGroup, direction: MoveDirection) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" aria-label={`Move ${group.name} up`}
        disabled={busy || position === 1} onClick={() => onMove(group, 'up')}>
        <span aria-hidden="true">↑</span>
      </Button>
      <Button type="button" variant="outline" size="icon" aria-label={`Move ${group.name} down`}
        disabled={busy || position === groupCount} onClick={() => onMove(group, 'down')}>
        <span aria-hidden="true">↓</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Rename ${group.name}`}
        disabled={busy}
        onClick={onStartRename}
      >
        Rename
      </Button>
      <Button type="button" variant="outline" size="icon" className="text-destructive"
        aria-label={`Delete ${group.name}`} disabled={busy} onClick={onDelete}>
        <span aria-hidden="true">✕</span>
      </Button>
    </div>
  );
}

function GroupRenameForm({
  group,
  busyKey,
  onRename,
  onDone,
}: {
  group: MenuGroup;
  busyKey: string | null;
  onRename: (group: MenuGroup, name: string, description: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const busy = busyKey !== null;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        const message = await onRename(group, name, description);
        if (message === null) onDone();
        else setError(message);
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <TextField id={`${ids}-name`} label="Group name" value={name} onChange={setName} />
        <TextField id={`${ids}-description`} label="Description (optional)" value={description}
          onChange={setDescription} />
      </fieldset>
      {error === null ? null : <p role="alert" className={ERROR_CLASS}>{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Cancel renaming ${group.name}`}
          disabled={busy}
          onClick={onDone}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busyKey === `group:${group._id}:rename` ? 'Saving…' : 'Save group'}
        </Button>
      </div>
    </form>
  );
}

export function GroupRow({
  group,
  position,
  groupCount,
  items,
  readOnly,
  busyKey,
  error,
  editorNode,
  onRename,
  onMove,
  onDelete,
  onAddItem,
  onEditItem,
  onMoveItem,
  onDeleteItem,
}: {
  group: MenuGroup;
  position: number;
  groupCount: number;
  items: MenuItem[];
  readOnly: boolean;
  busyKey: string | null;
  error: string | null;
  editorNode: ReactNode;
  onRename: (group: MenuGroup, name: string, description: string) => Promise<string | null>;
  onMove: (group: MenuGroup, direction: MoveDirection) => void;
  onDelete: (group: MenuGroup) => Promise<boolean>;
  onAddItem: (groupId: Id<'menuGroups'>) => void;
  onEditItem: (item: MenuItem) => void;
  onMoveItem: (groupId: Id<'menuGroups'>, item: MenuItem, direction: MoveDirection) => void;
  onDeleteItem: (groupId: Id<'menuGroups'>, itemId: Id<'menuItems'>) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = busyKey !== null;

  return (
    <li className="border-border rounded-card flex flex-col gap-3 border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold">{group.name}</h3>
          {group.description === undefined ? null : (
            <p className="text-card-muted text-sm">{group.description}</p>
          )}
        </div>
        {readOnly ? null : (
          <GroupActions
            group={group}
            position={position}
            groupCount={groupCount}
            busy={busy}
            onStartRename={() => setRenaming(true)}
            onMove={onMove}
            onDelete={() => setConfirmingDelete(true)}
          />
        )}
      </div>

      {readOnly ? null : renaming ? (
        <GroupRenameForm group={group} busyKey={busyKey} onRename={onRename}
          onDone={() => setRenaming(false)} />
      ) : null}

      {readOnly ? null : confirmingDelete ? (
        <InlineConfirm
          message="Delete this menu group? Groups with items cannot be deleted — delete or move its items first."
          confirmLabel="Delete group"
          destructive
          isPending={busyKey === `group:${group._id}:delete`}
          onConfirm={async () => {
            if (await onDelete(group)) setConfirmingDelete(false);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}

      {error === null ? null : <p role="alert" className={ERROR_CLASS}>{error}</p>}

      {items.length === 0 ? (
        <p className={NOTICE_CLASS}>No items in this group yet.</p>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {items.map((item, index) => (
            <ItemRow key={item._id} item={item} position={index + 1} count={items.length}
              readOnly={readOnly} busyKey={busyKey} groupId={group._id}
              onEdit={onEditItem} onMove={onMoveItem} onDelete={onDeleteItem} />
          ))}
        </ul>
      )}

      {editorNode}

      {readOnly ? null : (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Add item to ${group.name}`}
            disabled={busy}
            onClick={() => onAddItem(group._id)}
          >
            Add item
          </Button>
        </div>
      )}
    </li>
  );
}

export function AddGroupForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (name: string, description: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const ids = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="border-border rounded-control flex flex-col gap-2 border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        const message = await onSubmit(name, description);
        if (message !== null) setError(message);
      }}
    >
      <p className="text-sm font-semibold">New menu group</p>
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <TextField id={`${ids}-name`} label="Group name" value={name} placeholder="Starters, Mains, Drinks…"
          onChange={setName} />
        <TextField id={`${ids}-description`} label="Description (optional)" value={description}
          onChange={setDescription} />
      </fieldset>
      {error === null ? null : <p role="alert" className={ERROR_CLASS}>{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Cancel new group"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Adding…' : 'Add group'}
        </Button>
      </div>
    </form>
  );
}
