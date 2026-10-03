'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Minimal first-step "Add Your Business" form (contract §6): collects the
 * required name + category, creates the draft, then opens its editor. Any
 * signed-in user may use it — there is no role or admin gate at entry.
 */
export function CreateBusinessForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const categories = useQuery(api.categories.listOrdered);
  const createDraft = useMutation(api.businesses.mutations.createDraft);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedName = name.trim();
  const categoriesReady = (categories?.length ?? 0) > 0;
  const canSubmit =
    trimmedName.length > 0 && categoryId.length > 0 && categoriesReady && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const businessId = await createDraft({
        name: trimmedName,
        categoryId: categoryId as Id<'categories'>,
      });
      router.push(`/owner/business/${businessId}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Could not create the business.'
      );
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">Add your business</CardTitle>
        <CardDescription>
          Start with a name and a category. You can fill in the rest in the editor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="business-name">Business name</Label>
            <Input
              id="business-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Riverside Coffee"
              autoComplete="organization"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="business-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId} disabled={!categoriesReady}>
              <SelectTrigger id="business-category" className="w-full">
                <SelectValue
                  placeholder={categoriesReady ? 'Choose a category' : 'Loading categories…'}
                />
              </SelectTrigger>
              <SelectContent>
                {(categories ?? []).map((category) => (
                  <SelectItem key={category._id} value={category._id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? 'Creating…' : 'Create business'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
