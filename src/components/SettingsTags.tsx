import { useCallback, useState } from 'react';
import { useStore } from '../hooks/useStore.ts';
import { tagNameMaxLength } from '../lib/config.ts';
import { selectTagsBlock, type StoreApp } from '../lib/store-app.ts';
import type { TagRejection } from '../lib/tag-edit.ts';
import { idAvailable, idNew } from '../platform/id.ts';

function rejectionText(rejection: TagRejection): string {
  switch (rejection) {
    case 'name-empty':
      return 'Enter a name.';
    case 'name-too-long':
      return `Use at most ${tagNameMaxLength} characters.`;
    case 'name-invalid':
      return 'A name cannot contain control or invisible characters.';
    case 'name-taken':
      return 'A tag with that name already exists.';
    case 'name-taken-archived':
      return 'An archived tag has that name.';
    case 'tag-unknown':
    case 'tag-archived':
      return 'That tag is already gone.';
    default:
      throw new Error(`Unhandled tag rejection: ${String(rejection satisfies never)}`);
  }
}

export function SettingsTags({ store }: { store: StoreApp }) {
  const tags = useStore(store, (state) => state.data.tags);
  const blocked = useStore(store, selectTagsBlock) !== undefined;
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const secure = idAvailable();
  const canCreate = secure && !blocked;
  const active = tags.filter((tag) => tag.archivedAt === undefined);
  const archivedCount = tags.length - active.length;

  function onSubmit(event: { preventDefault: () => void }): void {
    event.preventDefault();
    const result = store.tagCreate({ id: idNew(), name, now: Date.now() });
    if (!result) {
      return;
    }
    setMessage(result.rejection === undefined ? '' : rejectionText(result.rejection));
    if (result.rejection === undefined) {
      setName('');
    }
  }

  const onArchive = useCallback(
    (id: string) => {
      const result = store.tagArchive({ id, now: Date.now() });
      setConfirmingId(undefined);
      setMessage(result?.rejection === undefined ? '' : rejectionText(result.rejection));
    },
    [store],
  );

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Tags</h2>
      {blocked ? <p className="text-sm">Your tags could not be read, so they cannot be changed to avoid overwriting them.</p> : null}
      <form className="flex flex-wrap gap-2" onSubmit={onSubmit}>
        <label className="flex-1">
          <span className="sr-only">New tag name</span>
          <input
            type="text"
            value={name}
            disabled={!canCreate}
            placeholder="New tag"
            className="w-full min-w-40 rounded border border-line bg-raised px-2 py-1"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!canCreate} className="rounded bg-accent px-4 py-1 text-accent-ink disabled:opacity-50">
          Add
        </button>
      </form>
      {secure ? null : <p className="text-sm text-muted">Adding tags needs a secure page (HTTPS or localhost).</p>}
      <p role="status" className="min-h-6 text-sm">
        {message}
      </p>
      <ul className="space-y-2">
        {active.map((tag) => (
          <li key={tag.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{tag.name}</span>
            {confirmingId === tag.id ? (
              <span className="flex gap-2 text-sm">
                <button type="button" autoFocus className="rounded border border-red-500 px-3 py-1" onClick={() => onArchive(tag.id)}>
                  Yes, archive
                </button>
                <button type="button" className="rounded border border-line px-3 py-1" onClick={() => setConfirmingId(undefined)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={blocked}
                className="rounded border border-line px-3 py-1 text-sm disabled:opacity-50"
                onClick={() => setConfirmingId(tag.id)}
              >
                Archive
              </button>
            )}
          </li>
        ))}
      </ul>
      {archivedCount > 0 ? <p className="text-sm text-muted">{archivedCount} archived. They leave the picker, and past sessions keep their tag.</p> : null}
    </section>
  );
}
