import { useAppUpdate } from '../hooks/useAppUpdate.ts';
import type { UpdateBlock } from '../lib/store-app.ts';
import type { AppUpdate } from '../platform/app-update.ts';

const reasons: Record<UpdateBlock, string> = {
  'session-running': 'Update after the current session ends.',
  'unsaved-changes': 'Recent changes are not saved to this browser. Export your data from Settings, then update.',
};

/** `block` is undefined where no store exists, because then nothing is running and nothing is unsaved. */
export function UpdatePrompt({ update, block }: { update: AppUpdate; block: UpdateBlock | undefined }) {
  const status = useAppUpdate(update);
  if (status === 'none') {
    return null;
  }
  return (
    <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded border border-accent bg-raised px-3 py-2 text-sm">
      <span>{block === undefined ? 'A new version of Trees is ready.' : `A new version of Trees is ready. ${reasons[block]}`}</span>
      <button
        type="button"
        className="shrink-0 rounded bg-accent px-3 py-1 text-accent-ink disabled:opacity-50"
        disabled={block !== undefined}
        onClick={() => void update.apply()}
      >
        Update
      </button>
    </div>
  );
}
