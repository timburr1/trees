export function StorageUnavailable({ error }: { error: unknown }) {
  return (
    <section className="space-y-3" role="alert">
      <h1 className="text-xl font-semibold">Trees cannot save data in this browser</h1>
      <p>
        The browser blocked site storage, so nothing could be kept between visits. Allow site data for this page (private windows often block it) and reload.
      </p>
      <p className="text-sm text-muted">{error instanceof Error ? error.message : String(error)}</p>
    </section>
  );
}
