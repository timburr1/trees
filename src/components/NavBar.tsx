export type Screen = 'focus' | 'forest';

export type FocusIndicator = 'idle' | 'running' | 'result';

const focusSuffix: Record<FocusIndicator, string> = { idle: '', running: ' (running)', result: ' (result ready)' };

/** The Focus button says when a session is running or a result waits, because the chime can sound while another screen is open. */
export function NavBar({ screen, focusIndicator, onNavigate }: { screen: Screen; focusIndicator: FocusIndicator; onNavigate: (screen: Screen) => void }) {
  const items: readonly { screen: Screen; label: string }[] = [
    { screen: 'focus', label: `Focus${focusSuffix[focusIndicator]}` },
    { screen: 'forest', label: 'Forest' },
  ];
  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex gap-2 border-t border-line bg-surface px-6 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {items.map((item) => (
        <button
          key={item.screen}
          type="button"
          aria-current={screen === item.screen ? 'page' : undefined}
          className={`flex-1 rounded px-3 py-2 ${screen === item.screen ? 'bg-accent text-accent-ink' : 'border border-line'}`}
          onClick={() => onNavigate(item.screen)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
