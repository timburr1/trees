import { memo, useEffect, useRef } from 'react';
import type { Species } from '../lib/species-catalog.ts';
import { TreeSprite } from './TreeSprite.tsx';

/** `shortfall` is how many more coins a locked species needs (0 or less when affordable). `focusHeading` moves focus to the name after a purchase, since the Buy button the user pressed disappears. */
export const ShopCard = memo(function ShopCard({
  species,
  owned,
  shortfall,
  canBuy,
  focusHeading,
  onBuy,
}: {
  species: Species;
  owned: boolean;
  shortfall: number;
  canBuy: boolean;
  focusHeading: boolean;
  onBuy: (species: Species) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) {
      heading.current?.focus();
    }
  }, [focusHeading]);
  const affordable = shortfall <= 0;
  const reasonId = `shop-${species.id}-reason`;
  return (
    <li className="space-y-2 rounded border border-line p-3">
      <div className="mx-auto h-24 w-20">
        <TreeSprite species={species} stage="full" dead={false} decorative />
      </div>
      <h2 ref={heading} tabIndex={-1} className="font-semibold">
        {species.name}
      </h2>
      {owned ? (
        <p className="text-sm text-muted">Owned</p>
      ) : (
        <>
          <p className="text-sm">{species.cost} coins</p>
          {/* aria-disabled instead of disabled, so a keyboard user can still reach the button and hear why it does nothing. */}
          <button
            type="button"
            aria-disabled={!affordable || !canBuy}
            aria-describedby={reasonId}
            className={`rounded px-3 py-1 ${affordable && canBuy ? 'bg-accent text-accent-ink' : 'border border-line opacity-60'}`}
            onClick={() => {
              if (affordable && canBuy) {
                onBuy(species);
              }
            }}
          >
            Buy
          </button>
          <p id={reasonId} className="text-sm text-muted">
            {affordable ? '' : `${shortfall} more ${shortfall === 1 ? 'coin' : 'coins'}`}
          </p>
        </>
      )}
    </li>
  );
});
