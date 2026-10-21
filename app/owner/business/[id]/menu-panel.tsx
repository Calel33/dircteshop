'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { EditorLoadBoundary } from './editor-load-boundary';
import { MENU_SECTION } from './editor-sections';
import { AddGroupForm, GroupRow, NOTICE_CLASS } from './menu-panel-groups';
import {
  buildSave,
  editorGroupId,
  emptyItemDraft,
  groupItemsByGroup,
  itemDraftFrom,
} from './menu-panel-helpers';
import type {
  ItemDraft,
  ItemEditorState,
  MenuGroup,
  MenuItem,
  MoveDirection,
} from './menu-panel-helpers';
import { ItemEditor } from './menu-panel-item-editor';
import { messageForError } from './photos-panel-helpers';

// B8 (issue #8) owner menu editor. Menus are content: writes publish
// immediately, so every action is a direct mutation plus the reactive
// `listMine` refresh — no draft/save machinery, no optimistic state. The panel
// is read-only while the listing is pendingReview / suspended / rejected,
// matching `convex/menus.ts` `assertMenuWritable`.

function MenuPanelContent({ businessId, readOnly }: { businessId: Id<'businesses'>; readOnly: boolean }) {
  const data = useQuery(api.menus.listMine, { businessId });
  const createGroupMutation = useMutation(api.menus.createGroup);
  const updateGroupMutation = useMutation(api.menus.updateGroup);
  const deleteGroupMutation = useMutation(api.menus.deleteGroup);
  const moveGroupMutation = useMutation(api.menus.moveGroup);
  const createItemMutation = useMutation(api.menus.createItem);
  const updateItemMutation = useMutation(api.menus.updateItem);
  const deleteItemMutation = useMutation(api.menus.deleteItem);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<ItemEditorState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [groupError, setGroupError] = useState<{ groupId: Id<'menuGroups'>; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const itemsByGroup = groupItemsByGroup(data?.items ?? []);
  const busy = busyKey !== null;

  if (data === undefined) {
    return (
      <Card className="rounded-card py-card">
        <CardHeader>
          <CardTitle className="font-display text-lg">{MENU_SECTION.label}</CardTitle>
          <CardDescription>{MENU_SECTION.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3" aria-busy="true" aria-label="Loading menu">
          <Skeleton className="rounded-card h-24 w-full" />
          <Skeleton className="rounded-control h-16 w-full" />
          <Skeleton className="rounded-control h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  function openCreate(groupId: Id<'menuGroups'>) {
    setSaveError(null);
    setEditor({ mode: 'create', groupId, draft: emptyItemDraft() });
  }

  function openEdit(item: MenuItem) {
    setSaveError(null);
    setEditor({ mode: 'edit', item, draft: itemDraftFrom(item) });
  }

  function changeDraft(patch: Partial<ItemDraft>) {
    setEditor((current) => (current === null ? current : { ...current, draft: { ...current.draft, ...patch } }));
  }

  async function runAction(
    key: string,
    action: () => Promise<unknown>,
    fallback: string,
    report: (message: string) => void,
  ): Promise<boolean> {
    setBusyKey(key);
    try {
      await action();
      return true;
    } catch (error) {
      report(messageForError(error, fallback));
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function runForMessage(
    key: string,
    action: () => Promise<unknown>,
    fallback: string,
  ): Promise<string | null> {
    setBusyKey(key);
    try {
      await action();
      return null;
    } catch (error) {
      return messageForError(error, fallback);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAddGroup(name: string, description: string): Promise<string | null> {
    const message = await runForMessage(
      'add-group',
      () => createGroupMutation({ businessId, name, description }),
      'The menu group could not be added. Try again.',
    );
    if (message === null) {
      setAddOpen(false);
      setAnnouncement('Menu group added.');
    }
    return message;
  }

  async function handleRenameGroup(group: MenuGroup, name: string, description: string): Promise<string | null> {
    const message = await runForMessage(
      `group:${group._id}:rename`,
      () => updateGroupMutation({ businessId, groupId: group._id, name, description }),
      'The menu group could not be saved. Try again.',
    );
    if (message === null) setAnnouncement('Menu group saved.');
    return message;
  }

  async function handleMoveGroup(group: MenuGroup, direction: MoveDirection) {
    setGroupError(null);
    const moved = await runAction(
      `group:${group._id}:${direction}`,
      () => moveGroupMutation({ businessId, groupId: group._id, direction }),
      'The menu group could not be moved. Try again.',
      (message) => setGroupError({ groupId: group._id, message }),
    );
    if (moved) setAnnouncement('Menu group moved.');
  }

  async function handleDeleteGroup(group: MenuGroup): Promise<boolean> {
    setGroupError(null);
    const deleted = await runAction(
      `group:${group._id}:delete`,
      () => deleteGroupMutation({ businessId, groupId: group._id }),
      'The menu group could not be deleted. Try again.',
      (message) => setGroupError({ groupId: group._id, message }),
    );
    if (deleted) setAnnouncement('Menu group deleted.');
    return deleted;
  }

  async function handleDeleteItem(groupId: Id<'menuGroups'>, itemId: Id<'menuItems'>): Promise<boolean> {
    setGroupError(null);
    const deleted = await runAction(
      `item:${itemId}:delete`,
      () => deleteItemMutation({ businessId, itemId }),
      'The menu item could not be deleted. Try again.',
      (message) => setGroupError({ groupId, message }),
    );
    if (deleted) setAnnouncement('Menu item deleted.');
    return deleted;
  }

  /**
   * Item ordering is global on the server while the editor presents groups.
   * Swapping the two `ordering` values of adjacent same-group items keeps the
   * move scoped to its group (two patch writes, one action).
   */
  async function handleMoveItem(groupId: Id<'menuGroups'>, item: MenuItem, direction: MoveDirection) {
    const groupItems = itemsByGroup.get(groupId) ?? [];
    const index = groupItems.findIndex((candidate) => candidate._id === item._id);
    const neighbour = groupItems[direction === 'up' ? index - 1 : index + 1];
    if (index < 0 || neighbour === undefined) return;

    setGroupError(null);
    const moved = await runAction(
      `item:${item._id}:${direction}`,
      async () => {
        await updateItemMutation({ businessId, itemId: item._id, patch: { ordering: neighbour.ordering } });
        await updateItemMutation({ businessId, itemId: neighbour._id, patch: { ordering: item.ordering } });
      },
      'The menu item could not be moved. Try again.',
      (message) => setGroupError({ groupId, message }),
    );
    if (moved) setAnnouncement('Menu item moved.');
  }

  async function handleSaveItem() {
    if (editor === null || busy) return;
    const { save, errors } = buildSave(editor);
    if (save === null) {
      setSaveError(errors.join(' '));
      return;
    }

    setBusyKey('item-save');
    setSaveError(null);
    try {
      if (save.mode === 'create') {
        await createItemMutation({ businessId, groupId: save.groupId, ...save.fields });
      } else {
        await updateItemMutation({ businessId, itemId: save.itemId, patch: save.patch });
      }
      setEditor(null);
      setAnnouncement(save.mode === 'create' ? 'Menu item added.' : 'Menu item saved.');
    } catch (error) {
      // Keep the editor open with the typed draft so the owner can retry.
      setSaveError(messageForError(error, 'The menu item could not be saved. Try again.'));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{MENU_SECTION.label}</CardTitle>
        <CardDescription>{MENU_SECTION.description}</CardDescription>
        {readOnly ? null : (
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Add menu group"
              disabled={busy}
              onClick={() => setAddOpen(true)}
            >
              Add group
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-gap">
        {readOnly ? (
          <p className={NOTICE_CLASS}>Menus are read-only while the listing is pending review, suspended, or rejected.</p>
        ) : null}
        {!readOnly && addOpen ? (
          <AddGroupForm busy={busy} onSubmit={handleAddGroup} onCancel={() => setAddOpen(false)} />
        ) : null}

        {data.groups.length === 0 ? (
          <div className="border-border rounded-card border-2 border-dashed p-6 text-center">
            <p className="font-medium">No menu yet</p>
            <p className="text-card-muted mt-1 text-sm">Create a group like Starters, Mains, or Drinks, then add items.</p>
            {readOnly ? null : (
              <Button className="mt-3" type="button" size="sm" onClick={() => setAddOpen(true)}>
                Add your first group
              </Button>
            )}
          </div>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {data.groups.map((group, index) => {
              const activeEditor = editor !== null && editorGroupId(editor) === group._id ? editor : null;
              return (
                <GroupRow key={group._id} group={group} position={index + 1} groupCount={data.groups.length}
                  items={itemsByGroup.get(group._id) ?? []} readOnly={readOnly} busyKey={busyKey}
                  error={groupError?.groupId === group._id ? groupError.message : null}
                  editorNode={readOnly || activeEditor === null ? null : (
                    <ItemEditor
                      key={activeEditor.mode === 'create' ? activeEditor.groupId : activeEditor.item._id}
                      businessId={businessId} mode={activeEditor.mode} draft={activeEditor.draft}
                      busy={busy} saving={busyKey === 'item-save'} error={saveError}
                      onChange={changeDraft} onSave={handleSaveItem} onCancel={() => setEditor(null)} />
                  )}
                  onRename={handleRenameGroup} onMove={handleMoveGroup} onDelete={handleDeleteGroup}
                  onAddItem={openCreate} onEditItem={openEdit} onMoveItem={handleMoveItem}
                  onDeleteItem={handleDeleteItem} />
              );
            })}
          </ul>
        )}

        <p className="text-card-muted text-xs">Menu edits are content — they publish immediately, without re-review.</p>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Owner menu editor (B8 / issue #8). The shared editor boundary catches a
 * `listMine` failure thrown during render (Convex `useQuery` surfaces query
 * errors that way) and offers the standard retry path.
 */
export function MenuPanel({ businessId, readOnly }: { businessId: Id<'businesses'>; readOnly: boolean }) {
  return (
    <EditorLoadBoundary>
      <MenuPanelContent businessId={businessId} readOnly={readOnly} />
    </EditorLoadBoundary>
  );
}
