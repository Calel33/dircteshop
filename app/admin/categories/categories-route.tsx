'use client';

import { useState, type FormEvent } from 'react';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * One row of the guarded `listAdminCategories` read. `referenceCount` is
 * exact up to the server's cap; `referenceCountCapped` switches the label to
 * `100+` — the local `referenceLabel` mirrors `formatBusinessCount` in
 * `convex/categoryAdminPolicy.ts`, so the count the UI shows is the count the
 * delete guard enforces.
 */
export type CategoryRow = {
  _id: Id<'categories'>;
  name: string;
  icon: string | null;
  ordering: number;
  referenceCount: number;
  referenceCountCapped: boolean;
};

/** What every guarded category mutation resolves to, so panels can stay open. */
export type CategoryActionResult = { ok: true } | { ok: false; error: string };

/** Mirrors `formatBusinessCount` (convex/categoryAdminPolicy.ts). */
function referenceLabel(count: number, isCapped: boolean): string {
  if (isCapped) {
    return `${count}+ businesses`;
  }
  return count === 1 ? '1 business' : `${count} businesses`;
}

/** True only for exactly one referencing business (capped counts are plural). */
function isSingleReference(count: number, isCapped: boolean): boolean {
  return !isCapped && count === 1;
}

/** Inline panel error line (B6a confirm-panel convention: `role="alert"`). */
function PanelError({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p role="alert" className="w-full text-xs text-danger">
      {message}
    </p>
  );
}

/**
 * Category manager presentation (issue #16, Task 5), matching the prototype's
 * card: position number, display-order list with ↑/↓ reorder controls
 * (disabled at the ends), the inline blocked-delete `.cat-block`, and the
 * inline edit / confirm panels reused from the B6a destructive-action pattern.
 * Reassignment is NOT an admin control here — the blocked state documents the
 * owner editor as the path that frees a referenced category.
 */
export function CategoriesRoute({
  categories,
  loading,
  isPending,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
}: {
  categories: CategoryRow[];
  loading: boolean;
  isPending: boolean;
  onAdd: (name: string) => Promise<CategoryActionResult>;
  onUpdate: (
    categoryId: Id<'categories'>,
    values: { name: string; icon: string }
  ) => Promise<CategoryActionResult>;
  onDelete: (categoryId: Id<'categories'>) => Promise<CategoryActionResult>;
  onReorder: (orderedIds: Id<'categories'>[]) => Promise<CategoryActionResult>;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<Id<'categories'> | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftIcon, setDraftIcon] = useState('');
  const [confirmId, setConfirmId] = useState<Id<'categories'> | null>(null);
  const [blockedId, setBlockedId] = useState<Id<'categories'> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  function closePanels() {
    setEditingId(null);
    setConfirmId(null);
    setBlockedId(null);
    setPanelError(null);
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (name === '' || isPending) {
      return;
    }
    setListError(null);
    const result = await onAdd(name);
    if (result.ok) {
      setNewName('');
    } else {
      setListError(result.error);
    }
  }

  function startEdit(category: CategoryRow) {
    setEditingId(category._id);
    setDraftName(category.name);
    setDraftIcon(category.icon ?? '');
    setConfirmId(null);
    setBlockedId(null);
    setPanelError(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim();
    if (editingId === null || name === '' || isPending) {
      return;
    }
    const result = await onUpdate(editingId, { name, icon: draftIcon });
    if (result.ok) {
      closePanels();
    } else {
      setPanelError(result.error);
    }
  }

  function startDelete(category: CategoryRow) {
    setEditingId(null);
    setConfirmId(null);
    setPanelError(null);
    // A referenced category can never be deleted (the server enforces it), so
    // the click surfaces the blocked state with the live count instead of a
    // confirm that would always fail.
    if (category.referenceCount > 0) {
      setBlockedId(category._id);
    } else {
      setBlockedId(null);
      setConfirmId(category._id);
    }
  }

  async function confirmDelete(category: CategoryRow) {
    if (isPending) {
      return;
    }
    const result = await onDelete(category._id);
    if (result.ok) {
      closePanels();
    } else {
      setPanelError(result.error);
    }
  }

  async function moveCategory(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= categories.length || isPending) {
      return;
    }
    const orderedIds = categories.map((category) => category._id);
    const moved = orderedIds[index];
    orderedIds[index] = orderedIds[target];
    orderedIds[target] = moved;

    setListError(null);
    const result = await onReorder(orderedIds);
    if (!result.ok) {
      setListError(result.error);
    }
  }

  return (
    <div className="grid gap-4 p-5">
      <div className="bg-card border-border rounded-shell shadow-sm border p-4">
        <h2 className="mb-1 text-base font-semibold">Categories</h2>
        <p className="text-card-muted mb-3 text-tiny">
          Super Admin only. Ordering persists as a category{' '}
          <code className="font-mono">ordering</code> field; delete is blocked while any business
          references the category.
        </p>

        <form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={handleAdd} noValidate>
          <Input
            id="new-category"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New category name"
            aria-label="New category name"
            className="rounded-input bg-card h-8 min-w-52 text-tiny"
            disabled={isPending}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="rounded-input"
            disabled={isPending || newName.trim() === ''}
          >
            Add category
          </Button>
        </form>

        {listError === null ? null : (
          <p role="alert" className="text-danger mb-3 text-tiny">
            {listError}
          </p>
        )}

        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading categories">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="border-border-strong text-muted-foreground rounded-menu border border-dashed p-6 text-center text-sm">
            No categories yet. Add the first category above.
          </div>
        ) : (
          <ul className="rounded-menu border-border overflow-hidden border">
            {categories.map((category, index) => {
              const single = isSingleReference(
                category.referenceCount,
                category.referenceCountCapped
              );

              return (
                <li
                  key={category._id}
                  className="border-border grid gap-2 border-t p-3 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground font-mono text-xs">{index + 1}</span>
                    <b className="text-sm font-semibold">{category.name}</b>
                    <span className="text-muted-foreground text-tiny">
                      {referenceLabel(category.referenceCount, category.referenceCountCapped)}
                    </span>
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-input"
                      aria-label={`Move ${category.name} up`}
                      disabled={isPending || index === 0}
                      onClick={() => moveCategory(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-input"
                      aria-label={`Move ${category.name} down`}
                      disabled={isPending || index === categories.length - 1}
                      onClick={() => moveCategory(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-input"
                      disabled={isPending}
                      onClick={() => startEdit(category)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-input text-danger hover:bg-danger-soft hover:text-danger-strong"
                      disabled={isPending}
                      onClick={() => startDelete(category)}
                    >
                      Delete
                    </Button>
                  </div>

                  {editingId === category._id ? (
                    <form
                      className="border-border bg-panel rounded-menu grid gap-2 border p-2 sm:flex sm:flex-wrap sm:items-end"
                      onSubmit={saveEdit}
                      noValidate
                    >
                      <div className="grid w-full gap-1 sm:w-64">
                        <Label htmlFor={`category-name-${category._id}`} className="text-xs">
                          Name
                        </Label>
                        <Input
                          id={`category-name-${category._id}`}
                          className="rounded-input bg-card h-8 text-tiny"
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          disabled={isPending}
                        />
                      </div>
                      <div className="grid w-full gap-1 sm:w-48">
                        <Label htmlFor={`category-icon-${category._id}`} className="text-xs">
                          Icon
                        </Label>
                        <Input
                          id={`category-icon-${category._id}`}
                          className="rounded-input bg-card h-8 text-tiny"
                          value={draftIcon}
                          onChange={(event) => setDraftIcon(event.target.value)}
                          placeholder="lucide icon name"
                          disabled={isPending}
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        className="rounded-input"
                        disabled={isPending || draftName.trim() === ''}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-input"
                        onClick={closePanels}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                      <PanelError message={panelError} />
                    </form>
                  ) : null}

                  {blockedId === category._id ? (
                    <div className="border-danger-border bg-danger-soft text-danger-strong rounded-menu flex flex-wrap items-center gap-2 border p-2 text-tiny">
                      <span>
                        <b>
                          {referenceLabel(category.referenceCount, category.referenceCountCapped)}
                        </b>{' '}
                        {single ? 'references' : 'reference'} this category. Reassign{' '}
                        {single ? 'it' : 'them'} in the owner editor, then delete.
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-input"
                        onClick={closePanels}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}

                  {confirmId === category._id ? (
                    <div className="border-border-strong bg-card rounded-menu grid gap-3 border p-3">
                      <div className="border-border bg-panel text-muted-foreground rounded-menu border p-3 text-tiny">
                        Delete <b>{category.name}</b>? This cannot be undone.
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-input"
                          onClick={closePanels}
                          disabled={isPending}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="rounded-input"
                          disabled={isPending}
                          onClick={() => confirmDelete(category)}
                        >
                          Delete category
                        </Button>
                      </div>
                      <PanelError message={panelError} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
