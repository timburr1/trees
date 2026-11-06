export type Strictness = 'strict' | 'relaxed';

export type WeekStart = 'sunday' | 'monday';

export type SessionMode = { readonly kind: 'countdown'; readonly plannedMs: number } | { readonly kind: 'stopwatch' };

export type SessionOutcome = { readonly kind: 'completed' } | { readonly kind: 'failed'; readonly reason: 'gave-up' | 'left' };

export type SessionActive = {
  readonly id: string;
  /** Epoch ms. */
  readonly startedAt: number;
  readonly mode: SessionMode;
  readonly tagId: string | undefined;
  readonly speciesId: string;
  /** Snapshot taken at start, so changing settings mid-session has no effect. */
  readonly strictness: Strictness;
  /** Last moment the page was known visible. */
  readonly lastSeenAt: number;
  /** Total time spent in finished pauses. */
  readonly pausedMs: number;
  /** Set while paused. */
  readonly pausedAt: number | undefined;
};

export type SessionFinished = {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly mode: SessionMode;
  readonly pausedMs: number;
  readonly tagId: string | undefined;
  readonly speciesId: string;
  readonly outcome: SessionOutcome;
};

export type Tag = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  /** Archiving is the only mutation of a tag. */
  readonly archivedAt: number | undefined;
};

export type Purchase = {
  readonly speciesId: string;
  readonly at: number;
  /** Recorded at purchase time, so re-pricing a species never rewrites history. */
  readonly cost: number;
};

export type Settings = {
  readonly strictness: Strictness;
  readonly defaultDurationMs: number;
  readonly soundOn: boolean;
  readonly weekStart: WeekStart;
};

export type UiState = {
  readonly lastAcknowledgedId: string | undefined;
  readonly lastExportedAt: number | undefined;
};

/** Everything that survives a reload. */
export type Persisted = {
  readonly active: SessionActive | undefined;
  readonly sessions: readonly SessionFinished[];
  readonly tags: readonly Tag[];
  readonly purchases: readonly Purchase[];
  readonly settings: Settings;
  readonly ui: UiState;
};
