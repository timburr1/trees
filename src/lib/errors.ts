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

/** The browser lacks a capability the app needs for the requested action, such as `crypto.randomUUID` outside a secure context. */
export class ErrorPlatformUnsupported extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorPlatformUnsupported';
  }
}

/** A backup file the app cannot import. The message says why in terms the user can act on. */
export class ErrorImportInvalid extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorImportInvalid';
  }
}

/** A replace failed partway and putting the old data back failed too, so what is on disk is neither old nor new. */
export class ErrorStorageRollback extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorStorageRollback';
  }
}
