import type { ReactNode } from 'react';

export type Screen = 'focus' | 'forest' | 'stats' | 'shop' | 'settings';

export type FocusIndicator = 'idle' | 'running' | 'result';

// A short mark keeps the tabs on one line at 320 px; the full wording goes in the accessible name. Tabs never shrink below their text, so large text wraps them to a second row instead of overflowing.
const focusMark: Record<FocusIndicator, string> = { idle: '', running: ' \u2022', result: ' !' };
const focusName: Record<FocusIndicator, string> = { idle: 'Focus', running: 'Focus (running)', result: 'Focus (result ready)' };

// An icon rather than the word: a fifth text tab does not fit one row at 320 px. The button's aria-label carries the name.
function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mx-auto"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** The Focus button says when a session is running or a result waits, because the chime can sound while another screen is open. */
export function NavBar({ screen, focusIndicator, onNavigate }: { screen: Screen; focusIndicator: FocusIndicator; onNavigate: (screen: Screen) => void }) {
  const items: readonly { screen: Screen; label: ReactNode; name: string }[] = [
    { screen: 'focus', label: `Focus${focusMark[focusIndicator]}`, name: focusName[focusIndicator] },
    { screen: 'forest', label: 'Forest', name: 'Forest' },
    { screen: 'stats', label: 'Stats', name: 'Stats' },
    { screen: 'shop', label: 'Shop', name: 'Shop' },
    { screen: 'settings', label: <SettingsIcon />, name: 'Settings' },
  ];
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex flex-wrap gap-1 border-t border-line bg-surface px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {items.map((item) => (
        <button
          key={item.screen}
          type="button"
          aria-label={item.name}
          aria-current={screen === item.screen ? 'page' : undefined}
          className={`min-w-fit flex-1 rounded px-1 py-2 text-sm ${screen === item.screen ? 'bg-accent text-accent-ink' : 'border border-line'}`}
          onClick={() => onNavigate(item.screen)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
