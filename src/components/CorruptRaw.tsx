export function CorruptRaw({ slice, raw, onCopyFailed }: { slice: string; raw: string; onCopyFailed: (message: string) => void }) {
  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(raw);
    } catch (error) {
      onCopyFailed(`Copying failed: ${error instanceof Error ? error.message : String(error)}. Select the text and copy it by hand.`);
    }
  }

  return (
    <div className="space-y-2">
      <p>The stored {slice} could not be read. The text is below, untouched. Copy it somewhere safe before clearing site data.</p>
      <textarea readOnly value={raw} aria-label={`Raw ${slice}`} className="h-32 w-full rounded border border-line bg-raised p-2 font-mono text-xs" />
      {/* The clipboard API exists only in secure contexts; without it, the textarea can still be selected by hand. */}
      {typeof navigator.clipboard === 'object' ? (
        <button type="button" className="rounded border border-line px-3 py-1" onClick={() => void onCopy()}>
          Copy
        </button>
      ) : null}
    </div>
  );
}
