'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Admin-created listing panel, inline in the dataset column (prototype
 * `addBusinessForm` inside `.inline-confirm`). The category picker is kept
 * because `createDraftForOwner` requires one.
 */
export function AddBusinessForm({
  categories,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  categories: { _id: string; name: string }[];
  onSubmit: (data: { name: string; categoryId: string; ownerEmail: string }) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [data, setData] = useState({ name: '', categoryId: '', ownerEmail: '' });

  return (
    <form
      className="border-border-strong bg-card rounded-menu grid gap-3 border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(data);
      }}
      noValidate
    >
      <div className="border-border bg-panel text-muted-foreground rounded-menu border p-3 text-tiny">
        Admin-created listing using the same flow as self-serve. Admin supplies the owner&rsquo;s
        email to assign ownership.
      </div>

      <div className="grid gap-1">
        <label htmlFor="add-name" className="text-muted-foreground text-xs font-semibold">
          Business name
        </label>
        <Input
          id="add-name"
          className="rounded-input bg-card h-8 text-tiny"
          placeholder="e.g. Harbor Books"
          required
          value={data.name}
          onChange={(event) => setData({ ...data, name: event.target.value })}
          disabled={isPending}
        />
      </div>

      <div className="grid gap-1">
        <label htmlFor="add-category" className="text-muted-foreground text-xs font-semibold">
          Category
        </label>
        <Select
          value={data.categoryId}
          onValueChange={(categoryId) => setData({ ...data, categoryId })}
          disabled={isPending}
        >
          <SelectTrigger id="add-category" size="sm" className="rounded-input bg-card w-full text-tiny">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category._id} value={category._id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1">
        <label htmlFor="add-email" className="text-muted-foreground text-xs font-semibold">
          Owner email
        </label>
        <Input
          id="add-email"
          className="rounded-input bg-card h-8 text-tiny"
          placeholder="owner@example.com"
          required
          type="email"
          value={data.ownerEmail}
          onChange={(event) => setData({ ...data, ownerEmail: event.target.value })}
          disabled={isPending}
        />
      </div>

      {error === null ? null : (
        <div role="alert" className="text-danger text-xs">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-input"
          onClick={() => {
            setData({ name: '', categoryId: '', ownerEmail: '' });
            onCancel();
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="rounded-input"
          disabled={isPending || !data.categoryId || data.name.trim() === ''}
        >
          Create draft
        </Button>
      </div>
    </form>
  );
}
