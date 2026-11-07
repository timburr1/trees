import { installStateGet } from './install-state.ts';

export type FileSaveResult = 'done' | 'cancelled';

export type FileSave = (name: string, text: string) => Promise<FileSaveResult>;

// The Blob URL must outlive the click: Firefox and older Safari start the download after it returns.
const REVOKE_DELAY_MS = 10_000;

function downloadStart(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Hands the user a JSON file. A download link everywhere except an installed iOS app, where iOS opens a viewer or fails on one,
 * so the share sheet is used there. Desktop browsers, installed or not, can share files too, but the sheet is the wrong tool for them.
 */
export async function fileSave(name: string, text: string, log: (message: string) => void): Promise<FileSaveResult> {
  const file = new File([text], name, { type: 'application/json' });
  const { ios, standalone } = installStateGet();
  if (ios && standalone && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'done';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log('file share cancelled');
        return 'cancelled';
      }
      log(`file share failed, downloading instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  downloadStart(file);
  return 'done';
}
