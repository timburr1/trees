/** Stored data that cannot be read as the type it should be. A user cannot cause this through normal use. */
export class ErrorStorageCorrupt extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorStorageCorrupt';
  }
}

/** The browser refused a write because the origin is out of space. */
export class ErrorStorageQuota extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorStorageQuota';
  }
}
