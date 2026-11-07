import { ownerLockAcquire, ownerLockSteal } from './owner-lock.ts';
import { locksFakeMake } from '../test/locks-fake.ts';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ownerLockAcquire', () => {
  it('becomes owner when the lock is free', async () => {
    const locks = locksFakeMake();
    const result = await ownerLockAcquire({ locks, onLost: () => {} });
    expect(result.kind).toBe('owner');
    expect(locks.held()).toBe(true);
  });

  it('reports another owner when the lock is held', async () => {
    const locks = locksFakeMake();
    await ownerLockAcquire({ locks, onLost: () => {} });
    const second = await ownerLockAcquire({ locks, onLost: () => {} });
    expect(second.kind).toBe('other');
  });

  it('reports unsupported when there is no lock manager', async () => {
    const result = await ownerLockAcquire({ locks: undefined, onLost: () => {} });
    expect(result.kind).toBe('unsupported');
  });

  it('frees the lock on release without calling onLost', async () => {
    const locks = locksFakeMake();
    const onLost = vi.fn();
    const first = await ownerLockAcquire({ locks, onLost });
    if (first.kind !== 'owner') {
      throw new Error('expected owner');
    }
    first.release();
    await tick();
    expect(locks.held()).toBe(false);
    expect(onLost).not.toHaveBeenCalled();
    expect((await ownerLockAcquire({ locks, onLost: () => {} })).kind).toBe('owner');
  });
});

describe('ownerLockSteal', () => {
  it('takes the lock and tells the old holder it lost', async () => {
    const locks = locksFakeMake();
    const oldLost = vi.fn();
    const newLost = vi.fn();
    await ownerLockAcquire({ locks, onLost: oldLost });
    const stolen = await ownerLockSteal({ locks, onLost: newLost });
    await tick();
    expect(stolen.kind).toBe('owner');
    expect(oldLost).toHaveBeenCalledTimes(1);
    expect(newLost).not.toHaveBeenCalled();
    expect(locks.held()).toBe(true);
  });
});
