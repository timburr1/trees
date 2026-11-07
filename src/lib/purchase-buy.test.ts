import { coinsBalance } from './coins.ts';
import { purchaseBuy } from './purchase-buy.ts';
import { speciesCatalog, speciesStarter } from './species-catalog.ts';
import { speciesOwned } from './species-owned.ts';
import { persistedMake, sessionCoinsEach, sessionsWithCoins } from '../test/fixtures.ts';

function species(id: string) {
  const found = speciesCatalog.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`the catalog must contain ${id}`);
  }
  return found;
}

const pine = species('pine');
const birch = species('birch');
const dataWithCoins = (coins: number) => persistedMake({ sessions: sessionsWithCoins(coins) });

describe('purchaseBuy', () => {
  it('appends one record with the catalog cost, the id, and the time', () => {
    const data = dataWithCoins(pine.cost);
    const result = purchaseBuy(data, { id: 'p1', speciesId: pine.id, now: 5_000 });
    expect(result.rejection).toBeUndefined();
    expect(result.state.purchases).toEqual([{ id: 'p1', speciesId: pine.id, at: 5_000, cost: pine.cost }]);
    expect(result.state.sessions).toBe(data.sessions);
    expect(speciesOwned(result.state, pine.id)).toBe(true);
  });

  it('charges each species its own cost when earlier purchases differ', () => {
    const first = purchaseBuy(dataWithCoins(pine.cost + birch.cost), { id: 'p1', speciesId: pine.id, now: 1 }).state;
    const second = purchaseBuy(first, { id: 'p2', speciesId: birch.id, now: 2 });
    expect(second.rejection).toBeUndefined();
    expect(second.state.purchases.map((entry) => entry.cost)).toEqual([pine.cost, birch.cost]);
  });

  it('succeeds at exactly the price and leaves nothing', () => {
    const result = purchaseBuy(dataWithCoins(pine.cost), { id: 'p1', speciesId: pine.id, now: 1 });
    expect(result.rejection).toBeUndefined();
    expect(coinsBalance(result.state)).toBe(0);
  });

  it('rejects one session short and changes nothing', () => {
    const short = dataWithCoins(pine.cost - sessionCoinsEach);
    const result = purchaseBuy(short, { id: 'p1', speciesId: pine.id, now: 1 });
    expect(result.rejection).toBe('insufficient-coins');
    expect(result.state).toBe(short);
  });

  it('rejects a species already bought, and a second identical call after a success (a double tap)', () => {
    const first = purchaseBuy(dataWithCoins(pine.cost * 2), { id: 'p1', speciesId: pine.id, now: 1 });
    const again = purchaseBuy(first.state, { id: 'p2', speciesId: pine.id, now: 2 });
    expect(again.rejection).toBe('already-owned');
    expect(again.state).toBe(first.state);
  });

  it('rejects the free species as already owned', () => {
    const data = dataWithCoins(sessionCoinsEach);
    const result = purchaseBuy(data, { id: 'p1', speciesId: speciesStarter.id, now: 1 });
    expect(result.rejection).toBe('already-owned');
    expect(result.state).toBe(data);
  });

  it('rejects an id the catalog lacks', () => {
    const data = dataWithCoins(pine.cost);
    const result = purchaseBuy(data, { id: 'p1', speciesId: 'from-a-newer-version', now: 1 });
    expect(result.rejection).toBe('unknown-species');
    expect(result.state).toBe(data);
  });
});
