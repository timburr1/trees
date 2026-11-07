export function OwnerBlocked({ onUseHere }: { onUseHere: () => void }) {
  return (
    <section className="space-y-3" role="alert">
      <h1 className="text-xl font-semibold">Trees is open in another tab</h1>
      <p>Only one tab can run sessions at a time, so two tabs cannot record the same session twice.</p>
      <button type="button" className="rounded bg-accent px-4 py-2 text-accent-ink" onClick={onUseHere}>
        Use here
      </button>
    </section>
  );
}
