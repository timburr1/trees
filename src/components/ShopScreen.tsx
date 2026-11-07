import { useCallback, useState } from 'react';
import { useStore } from '../hooks/useStore.ts';
import { coinsBalance } from '../lib/coins.ts';
import type { PurchaseRejection } from '../lib/purchase-buy.ts';
import { speciesCatalog, type Species } from '../lib/species-catalog.ts';
import { speciesOwned } from '../lib/species-owned.ts';
import { selectPurchasesBlock, type PurchasesBlock, type StoreApp } from '../lib/store-app.ts';
import { idAvailable, idNew } from '../platform/id.ts';
import { ShopCard } from './ShopCard.tsx';

function blockMessage(block: PurchasesBlock): string {
  switch (block) {
    case 'sessions-unreadable':
      return 'Your session history could not be read, so coins cannot be counted.';
    case 'purchases-unreadable':
      return 'Your purchases could not be read, so buying is off to avoid overwriting them.';
    case 'purchases-rejected':
      return 'Some stored purchase records are not valid, so coins and owned species may be wrong and buying is off. The records are kept.';
    default:
      throw new Error(`Unhandled purchases block: ${String(block satisfies never)}`);
  }
}

function rejectionMessage(rejection: Exclude<PurchaseRejection, 'already-owned'>): string {
  switch (rejection) {
    case 'insufficient-coins':
      return 'Not enough coins.';
    case 'unknown-species':
      return 'This version does not know that tree.';
    default:
      throw new Error(`Unhandled purchase rejection: ${String(rejection satisfies never)}`);
  }
}

export function ShopScreen({ store }: { store: StoreApp }) {
  const sessions = useStore(store, (state) => state.data.sessions);
  const purchases = useStore(store, (state) => state.data.purchases);
  const block = useStore(store, selectPurchasesBlock);
  const [message, setMessage] = useState('');
  const [boughtId, setBoughtId] = useState<string | undefined>(undefined);
  const canBuy = idAvailable();

  const onBuy = useCallback(
    (species: Species) => {
      const result = store.purchaseBuy({ id: idNew(), speciesId: species.id, now: Date.now() });
      // Ignored, or a double tap on a card that is already Owned: the grid shows the truth and the last message stands.
      if (!result || result.rejection === 'already-owned') {
        return;
      }
      if (result.rejection === undefined) {
        setMessage(`Bought ${species.name}.`);
        setBoughtId(species.id);
      } else {
        setMessage(rejectionMessage(result.rejection));
        setBoughtId(undefined);
      }
    },
    [store],
  );

  // A plain paragraph, not an alert: a blocking status banner already announces an unreadable slice.
  if (block !== undefined) {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Shop</h1>
        <p>{blockMessage(block)}</p>
      </section>
    );
  }

  const balance = coinsBalance({ sessions, purchases });
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Shop</h1>
      <p>
        {balance} {balance === 1 ? 'coin' : 'coins'}
      </p>
      {canBuy ? null : <p className="text-sm text-muted">Buying needs a secure page (HTTPS or localhost).</p>}
      <p role="status" className="min-h-6 text-sm">
        {message}
      </p>
      <ul className="grid grid-cols-2 gap-3">
        {speciesCatalog.map((species) => (
          <ShopCard
            key={species.id}
            species={species}
            owned={speciesOwned({ purchases }, species.id)}
            shortfall={species.cost - balance}
            canBuy={canBuy}
            focusHeading={boughtId === species.id}
            onBuy={onBuy}
          />
        ))}
      </ul>
    </section>
  );
}
