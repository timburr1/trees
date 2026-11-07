import { useState } from 'react';
import { installNote, type InstallNote as Note } from '../lib/install-note.ts';
import { installStateGet } from '../platform/install-state.ts';

const texts: Record<Note, string> = {
  'install-first':
    'Add Trees to your Home Screen before your first session. The browser and the installed app keep separate forests, so a forest started in the browser does not carry over.',
  'bring-data': 'Coming from the browser? Export a backup there, then import it in Settings here.',
  'moving-data': 'The installed app starts with an empty forest. Export a backup here, then import it in the installed app under Settings.',
};

/** `where` picks which notes belong on this screen; the install question comes before the first session, the data question wherever backups live. */
export function InstallNote({ where, sessionCount }: { where: 'focus' | 'settings'; sessionCount: number }) {
  const [env] = useState(installStateGet);
  const note = installNote(env, sessionCount);
  if (note === undefined || (note === 'moving-data') !== (where === 'settings')) {
    return null;
  }
  return (
    <p role="note" className="rounded border border-line bg-raised px-3 py-2 text-sm">
      {texts[note]}
    </p>
  );
}
