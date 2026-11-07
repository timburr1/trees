export type Screen = 'focus' | 'forest' | 'stats' | 'shop';

export type FocusIndicator = 'idle' | 'running' | 'result';

// A short mark keeps the tabs on one line at 320 px; the full wording goes in the accessible name. Tabs never shrink below their text, so large text wraps them to a second row instead of overflowing.
const focusMark: Record<FocusIndicator, string> = { idle: '', running: ' \u2022', result: ' !' };
const focusName: Record<FocusIndicator, string> = { idle: 'Focus', running: 'Focus (running)', result: 'Focus (result ready)' };

/** The Focus button says when a session is running or a result waits, because the chime can sound while another screen is open. */
export function NavBar({ screen, focusIndicator, onNavigate }: { screen: Screen; focusIndicator: FocusIndicator; onNavigate: (screen: Screen) => void }) {
  const items: readonly { screen: Screen; label: string; name: string }[] = [
    { screen: 'focus', label: `Focus${focusMark[focusIndicator]}`, name: focusName[focusIndicator] },
    { screen: 'forest', label: 'Forest', name: 'Forest' },
    { screen: 'stats', label: 'Stats', name: 'Stats' },
    { screen: 'shop', label: 'Shop', name: 'Shop' },
  ];
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex flex-wrap gap-1 border-t border-line bg-surface px-6 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {items.map((item) => (
        <button
          key={item.screen}
          type="button"
          aria-label={item.name}
          aria-current={screen === item.screen ? 'page' : undefined}
          className={`min-w-fit flex-1 rounded px-2 py-2 text-sm ${screen === item.screen ? 'bg-accent text-accent-ink' : 'border border-line'}`}
          onClick={() => onNavigate(item.screen)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
