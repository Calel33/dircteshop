'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function AddBusinessForm({ 
  categories,
  onSubmit,
  isPending,
  error
}: { 
  categories: { _id: string, name: string }[];
  onSubmit: (data: { name: string, categoryId: string, ownerEmail: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [data, setData] = useState({ name: '', categoryId: '', ownerEmail: '' });

  return (
    <form className="space-y-4 p-4 border rounded-card bg-card" onSubmit={(e) => {
      e.preventDefault();
      onSubmit(data);
    }}>
      <div className="space-y-1">
        <Label htmlFor="name">Business Name</Label>
        <Input id="name" required value={data.name} onChange={(e) => setData({...data, name: e.target.value})} disabled={isPending} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="category">Category</Label>
        <Select value={data.categoryId} onValueChange={(categoryId) => setData({...data, categoryId})} disabled={isPending}>
          <SelectTrigger id="category">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Owner Email</Label>
        <Input id="email" required type="email" value={data.ownerEmail} onChange={(e) => setData({...data, ownerEmail: e.target.value})} disabled={isPending} />
      </div>
      {error && <div role="alert" className="text-destructive text-sm">{error}</div>}
      <Button type="button" variant="ghost" size="sm" onClick={() => { setData({ name: '', categoryId: '', ownerEmail: '' }); }}>Cancel</Button>
      <Button type="submit" disabled={isPending || !data.categoryId}>Create Draft</Button>
    </form>
  );
}
