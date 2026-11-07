import { tagNameMaxLength } from './config.ts';
import type { Persisted, Tag } from './types.ts';

/** `name-taken-archived` is split out so the screen can say the name belongs to a hidden tag. */
export type TagRejection = 'name-empty' | 'name-too-long' | 'name-invalid' | 'name-taken' | 'name-taken-archived' | 'tag-unknown' | 'tag-archived';

export type TagCreateRequest = { readonly id: string; readonly name: string; readonly now: number };
export type TagArchiveRequest = { readonly id: string; readonly now: number };

export type TagResult = { readonly state: Persisted; readonly rejection: TagRejection | undefined };

// Whitespace runs collapse first, so a tab or newline becomes a space instead of failing the control-character check.
function nameNormalize(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

// Names compare by their normalized, lowercased form, so "Café" typed two ways, or in another case, is one name.
function nameKey(name: string): string {
  return nameNormalize(name).toLowerCase();
}

/** The tags a session can be started with: oldest first, which is stored order, and not archived. */
export function tagsActive(tags: readonly Tag[]): readonly Tag[] {
  return tags.filter((tag) => tag.archivedAt === undefined);
}

/** The chosen tag if it can still be picked, else undefined, so a tag archived or gone since it was chosen is simply not selected. */
export function tagChosenEffective(tags: readonly Tag[], chosenId: string | undefined): string | undefined {
  return tagsActive(tags).find((tag) => tag.id === chosenId)?.id;
}

export function tagCreate(state: Persisted, request: TagCreateRequest): TagResult {
  const name = nameNormalize(request.name);
  if (name === '') {
    return { state, rejection: 'name-empty' };
  }
  // A zero-width joiner is how emoji sequences (a person at a laptop) are built, so it is allowed; the other invisible characters are not.
  if (/[\p{Cc}\p{Cf}]/u.test(name.replaceAll('\u200D', ''))) {
    return { state, rejection: 'name-invalid' };
  }
  if (Array.from(name).length > tagNameMaxLength) {
    return { state, rejection: 'name-too-long' };
  }
  // Archived tags count: stats and the Forest show names, and two tags with one name would be indistinguishable there.
  const same = state.tags.find((tag) => nameKey(tag.name) === nameKey(name));
  if (same) {
    return { state, rejection: same.archivedAt === undefined ? 'name-taken' : 'name-taken-archived' };
  }
  const tag = { id: request.id, name, createdAt: request.now, archivedAt: undefined };
  return { state: { ...state, tags: [...state.tags, tag] }, rejection: undefined };
}

export function tagArchive(state: Persisted, request: TagArchiveRequest): TagResult {
  const tag = state.tags.find((entry) => entry.id === request.id);
  if (!tag) {
    return { state, rejection: 'tag-unknown' };
  }
  if (tag.archivedAt !== undefined) {
    return { state, rejection: 'tag-archived' };
  }
  return { state: { ...state, tags: state.tags.map((entry) => (entry === tag ? { ...entry, archivedAt: request.now } : entry)) }, rejection: undefined };
}
