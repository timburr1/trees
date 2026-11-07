export function SessionsBlocked({ raw }: { raw: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Session history unreadable</h2>
      <p>The stored text is below, untouched. Copy it somewhere safe before clearing site data.</p>
      <textarea readOnly value={raw} aria-label="Raw session history" className="h-48 w-full rounded border border-line bg-raised p-2 font-mono text-xs" />
      {/* The clipboard API exists only in secure contexts; without it, the textarea can still be selected by hand. */}
      {typeof navigator.clipboard === 'object' ? (
        <button type="button" className="rounded border border-line px-3 py-1" onClick={() => void navigator.clipboard.writeText(raw)}>
          Copy
        </button>
      ) : null}
    </section>
  );
}
