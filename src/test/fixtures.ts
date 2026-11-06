import type { Persisted, Purchase, SessionActive, SessionFinished, Settings, Tag, UiState } from '../lib/types.ts';

const MINUTE_MS = 60_000;

export function sessionActiveMake(overrides: Partial<SessionActive> = {}): SessionActive {
  return {
    id: 'session-active',
    startedAt: 1_000_000,
    mode: { kind: 'countdown', plannedMs: 25 * MINUTE_MS },
    tagId: undefined,
    speciesId: 'oak',
    strictness: 'strict',
    lastSeenAt: 1_000_000,
    pausedMs: 0,
    pausedAt: undefined,
    ...overrides,
  };
}

export function sessionFinishedMake(overrides: Partial<SessionFinished> = {}): SessionFinished {
  return {
    id: 'session-finished',
    startedAt: 1_000_000,
    endedAt: 1_000_000 + 25 * MINUTE_MS,
    mode: { kind: 'countdown', plannedMs: 25 * MINUTE_MS },
    pausedMs: 0,
    tagId: undefined,
    speciesId: 'oak',
    outcome: { kind: 'completed' },
    ...overrides,
  };
}

export function tagMake(overrides: Partial<Tag> = {}): Tag {
  return { id: 'tag-1', name: 'Writing', createdAt: 1_000_000, archivedAt: undefined, ...overrides };
}

export function purchaseMake(overrides: Partial<Purchase> = {}): Purchase {
  return { speciesId: 'pine', at: 1_000_000, cost: 10, ...overrides };
}

export function settingsMake(overrides: Partial<Settings> = {}): Settings {
  return { strictness: 'strict', defaultDurationMs: 25 * MINUTE_MS, soundOn: true, weekStart: 'sunday', ...overrides };
}

export function persistedMake(overrides: Partial<Persisted> = {}): Persisted {
  return { active: undefined, sessions: [], tags: [], purchases: [], settings: settingsMake(), ui: uiMake(), ...overrides };
}

export function uiMake(overrides: Partial<UiState> = {}): UiState {
  return { lastAcknowledgedId: undefined, lastExportedAt: undefined, ...overrides };
}
