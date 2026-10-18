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
    <p role="alert" className="w-full text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Category manager presentation (issue #16, Task 5), matching the
 * `admin-workspace.html` prototype 1:1: position number, display-order list
 * with ↑/↓ reorder controls (disabled at the ends), the inline blocked-delete
 * state showing the live referencing count, and the inline edit / confirm
 * panels reused from the B6a destructive-action pattern. Reassignment is NOT
 * an admin control here — the blocked state documents the owner editor as the
 * path that frees a referenced category.
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
    <div className="p-6 space-y-4">
      <div className="rounded-card border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-medium">Categories</h2>
          <p className="text-sm text-card-muted">
            Super Admin only. Ordering persists as a category ordering field; delete is blocked
            while any business references the category.
          </p>
        </div>

        <form className="flex flex-wrap items-center gap-2" onSubmit={handleAdd} noValidate>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New category name"
            aria-label="New category name"
            className="w-full sm:w-64"
            disabled={isPending}
          />
          <Button type="submit" size="sm" disabled={isPending || newName.trim() === ''}>
            Add category
          </Button>
        </form>

        {listError ? (
          <p role="alert" className="text-sm text-destructive">
            {listError}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading categories">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full bg-muted-foreground/20" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <div className="rounded-control border border-dashed border-border p-6 text-center text-sm text-card-muted">
            No categories yet. Add the first category above.
          </div>
        ) : (
          <ul className="overflow-hidden rounded-control border border-border">
            {categories.map((category, index) => {
              const single = isSingleReference(
                category.referenceCount,
                category.referenceCountCapped
              );

              return (
                <li
                  key={category._id}
                  className="grid gap-2 border-t border-border p-3 first:border-t-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-label text-xs text-card-muted">{index + 1}</span>
                    <span className="text-sm font-semibold">{category.name}</span>
                    <span className="text-xs text-card-muted">
                      {referenceLabel(category.referenceCount, category.referenceCountCapped)}
                    </span>
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${category.name} up`}
                      disabled={isPending || index === 0}
                      onClick={() => moveCategory(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${category.name} down`}
                      disabled={isPending || index === categories.length - 1}
                      onClick={() => moveCategory(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => startEdit(category)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={isPending}
                      onClick={() => startDelete(category)}
                    >
                      Delete
                    </Button>
                  </div>

                  {editingId === category._id ? (
                    <form
                      className="flex flex-wrap items-end gap-2 rounded-control border border-border bg-muted p-2"
                      onSubmit={saveEdit}
                      noValidate
                    >
                      <div className="flex w-full flex-col gap-1 sm:w-64">
                        <Label htmlFor={`category-name-${category._id}`}>Name</Label>
                        <Input
                          id={`category-name-${category._id}`}
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          disabled={isPending}
                        />
                      </div>
                      <div className="flex w-full flex-col gap-1 sm:w-48">
                        <Label htmlFor={`category-icon-${category._id}`}>Icon</Label>
                        <Input
                          id={`category-icon-${category._id}`}
                          value={draftIcon}
                          onChange={(event) => setDraftIcon(event.target.value)}
                          placeholder="lucide icon name"
                          disabled={isPending}
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={isPending || draftName.trim() === ''}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={closePanels}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
                      <PanelError message={panelError} />
                    </form>
                  ) : null}

                  {blockedId === category._id ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-control border border-destructive/40 bg-destructive/10 p-2 text-sm text-card-foreground">
                      <span>
                        <span className="font-semibold">
                          {referenceLabel(category.referenceCount, category.referenceCountCapped)}
                        </span>{' '}
                        {single ? 'references' : 'reference'} this category. Reassign{' '}
                        {single ? 'it' : 'them'} in the owner editor, then delete.
                      </span>
                      <Button variant="ghost" size="sm" onClick={closePanels}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}

                  {confirmId === category._id ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-control border border-border bg-muted p-2 text-sm">
                      <span>Delete &ldquo;{category.name}&rdquo;? This cannot be undone.</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isPending}
                        onClick={() => confirmDelete(category)}
                      >
                        Delete category
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={closePanels}
                        disabled={isPending}
                      >
                        Cancel
                      </Button>
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
