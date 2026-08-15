import type { TargetAction } from './types.js';

export class RegistryValidationError extends Error {
  public constructor(path: string, message: string) {
    super(`Invalid target registry at ${path}: ${message}`);
    this.name = 'RegistryValidationError';
  }
}

export class UnknownTargetError extends Error {
  public constructor(targetKey: string) {
    super(`Unknown semantic target: ${targetKey}`);
    this.name = 'UnknownTargetError';
  }
}

export class TargetActionNotAllowedError extends Error {
  public constructor(targetKey: string, action: TargetAction) {
    super(`Target "${targetKey}" does not allow the "${action}" action`);
    this.name = 'TargetActionNotAllowedError';
  }
}
