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

/** The sync server says nobody is signed in (401). */
export class ErrorSyncAuth extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorSyncAuth';
  }
}

/** The signed-in account is not allowed to sync (403). */
export class ErrorSyncDenied extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorSyncDenied';
  }
}

/** The account signed in now is not the one this request was made for (409). */
export class ErrorSyncAccount extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorSyncAccount';
  }
}

/** The request never reached the sync server (offline, DNS, a dropped connection). */
export class ErrorSyncNetwork extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorSyncNetwork';
  }
}

/** The sync server failed or refused the request for another reason. */
export class ErrorSyncServer extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorSyncServer';
  }
}

/** The sync server answered with something that is not the documented shape. */
export class ErrorSyncResponse extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ErrorSyncResponse';
  }
}
