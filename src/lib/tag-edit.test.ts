import { tagArchive, tagChosenEffective, tagCreate, tagsActive } from './tag-edit.ts';
import { tagNameMaxLength } from './config.ts';
import { at } from '../test/at.ts';
import { persistedMake, tagMake } from '../test/fixtures.ts';

const now = at('2026-03-10T09:00:00-06:00');
const create = (name: string, state = persistedMake()) => tagCreate(state, { id: 'new', name, now });

describe('tagCreate', () => {
  it('appends one tag with the id, the time, and no archive time', () => {
    const state = persistedMake({ tags: [tagMake({ id: 'old', name: 'Reading' })] });
    const result = create('Writing', state);
    expect(result.rejection).toBeUndefined();
    expect(result.state.tags.at(-1)).toEqual({ id: 'new', name: 'Writing', createdAt: now, archivedAt: undefined });
    expect(result.state.tags).toHaveLength(2);
    expect(state.tags).toHaveLength(1);
  });

  it('trims the name and collapses inner whitespace runs', () => {
    expect(create('  Deep \t  work  ').state.tags[0]?.name).toBe('Deep work');
  });

  it('stores the composed form of a name typed in the decomposed form', () => {
    const decomposed = 'Café';
    expect(create(decomposed).state.tags[0]?.name).toBe('Café');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(create('').rejection).toBe('name-empty');
    expect(create(' \t ').rejection).toBe('name-empty');
  });

  it('accepts an emoji sequence that joins with a zero-width joiner', () => {
    expect(create('\u{1F469}\u200D\u{1F4BB} Work').rejection).toBeUndefined();
  });

  it('rejects control and zero-width characters', () => {
    expect(create('a\u0000b').rejection).toBe('name-invalid');
    expect(create('a​b').rejection).toBe('name-invalid');
  });

  it('counts the length in code points, so an emoji is one', () => {
    expect(create('a'.repeat(tagNameMaxLength)).rejection).toBeUndefined();
    expect(create('a'.repeat(tagNameMaxLength + 1)).rejection).toBe('name-too-long');
    expect(create('\u{1F333}'.repeat(tagNameMaxLength)).rejection).toBeUndefined();
  });

  it('rejects a name another tag has, ignoring case and the composed or decomposed form', () => {
    const state = persistedMake({ tags: [tagMake({ name: 'Café' })] });
    expect(create('cafÉ', state).rejection).toBe('name-taken');
    expect(create('Café', state).rejection).toBe('name-taken');
  });

  it('rejects the name of an archived tag, and says it is archived', () => {
    const state = persistedMake({ tags: [tagMake({ name: 'Work', archivedAt: now - 1 })] });
    const result = create('work', state);
    expect(result.rejection).toBe('name-taken-archived');
    expect(result.state).toBe(state);
  });

  it('returns the same state object on any rejection', () => {
    const state = persistedMake();
    expect(create('', state).state).toBe(state);
  });
});

describe('tagsActive and tagChosenEffective', () => {
  const tags = [tagMake({ id: 'a' }), tagMake({ id: 'b', name: 'Gone', archivedAt: 5 }), tagMake({ id: 'c', name: 'Other' })];

  it('lists the unarchived tags in stored order', () => {
    expect(tagsActive(tags).map((tag) => tag.id)).toEqual(['a', 'c']);
  });

  it('keeps a pickable choice and drops an archived, unknown, or absent one', () => {
    expect(tagChosenEffective(tags, 'c')).toBe('c');
    expect(tagChosenEffective(tags, 'b')).toBeUndefined();
    expect(tagChosenEffective(tags, 'nope')).toBeUndefined();
    expect(tagChosenEffective(tags, undefined)).toBeUndefined();
  });
});

describe('tagArchive', () => {
  const state = persistedMake({ tags: [tagMake({ id: 't1' }), tagMake({ id: 't2', name: 'Other' })] });

  it('sets the archive time on that tag only', () => {
    const result = tagArchive(state, { id: 't1', now });
    expect(result.rejection).toBeUndefined();
    expect(result.state.tags.map((tag) => tag.archivedAt)).toEqual([now, undefined]);
    expect(state.tags[0]?.archivedAt).toBeUndefined();
  });

  it('rejects an unknown tag and an already archived one without changing anything', () => {
    expect(tagArchive(state, { id: 'nope', now }).rejection).toBe('tag-unknown');
    const archived = tagArchive(state, { id: 't1', now }).state;
    const again = tagArchive(archived, { id: 't1', now: now + 1 });
    expect(again.rejection).toBe('tag-archived');
    expect(again.state).toBe(archived);
  });
});
