import { ErrorPlatformUnsupported } from '../lib/errors.ts';

/** `crypto.randomUUID` exists only in secure contexts (HTTPS or localhost). */
export function idAvailable(): boolean {
  return typeof crypto.randomUUID === 'function';
}

export function idNew(): string {
  if (!idAvailable()) {
    throw new ErrorPlatformUnsupported('Starting a session needs a secure context (HTTPS or localhost)');
  }
  return crypto.randomUUID();
}
