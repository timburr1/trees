/** Stands in for the grown tree until species art exists. `progress` runs from 0 to 1. */
export function TreePlaceholder({ progress }: { progress: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="space-y-2 text-center">
      <p className="text-muted">[Placeholder: Tree]</p>
      <div role="progressbar" aria-label="Growth" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-3 overflow-hidden rounded bg-line">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
