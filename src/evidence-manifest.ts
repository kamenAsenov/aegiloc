import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { AuditEvidenceError } from './errors.js';
import {
  createAuditEvidenceSummary,
  serializeAuditHistory,
  type AuditEvidenceSummary,
} from './evidence.js';
import { parseAuditHistory } from './proposals.js';

export const EVIDENCE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const EVIDENCE_DIGEST_ALGORITHM = 'sha256' as const;
export const EVIDENCE_AUTHENTICATION_ALGORITHM = 'hmac-sha256' as const;
export const MINIMUM_EVIDENCE_KEY_BYTES = 32 as const;

export type EvidenceFileKind = 'history' | 'summary';

export interface EvidenceFileDigest {
  readonly kind: EvidenceFileKind;
  readonly path: string;
  readonly byteLength: number;
  readonly algorithm: typeof EVIDENCE_DIGEST_ALGORITHM;
  readonly digest: string;
}

export interface EvidenceManifestAuthentication {
  readonly algorithm: typeof EVIDENCE_AUTHENTICATION_ALGORITHM;
  readonly keyId: string;
  readonly signature: string;
}

export interface EvidenceManifest {
  readonly schemaVersion: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly files: readonly [EvidenceFileDigest, EvidenceFileDigest];
  readonly authentication?: EvidenceManifestAuthentication;
}

export interface EvidenceManifestAuthenticationInput {
  readonly key: Uint8Array;
  readonly keyId: string;
}

export interface WriteEvidenceManifestOptions {
  readonly historyPath: string;
  readonly summaryPath: string;
  readonly manifestPath: string;
  readonly authentication?: EvidenceManifestAuthenticationInput;
  readonly force?: boolean;
}

export interface VerifyEvidenceManifestOptions {
  readonly manifestPath: string;
  readonly key?: Uint8Array;
  readonly expectedKeyId?: string;
  readonly requireAuthenticated?: boolean;
}

export interface VerifiedEvidenceManifest {
  readonly manifest: EvidenceManifest;
  readonly summary: AuditEvidenceSummary;
  readonly authenticated: boolean;
  readonly eventCount: number;
}

interface UnsignedEvidenceManifest {
  readonly schemaVersion: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly files: readonly [EvidenceFileDigest, EvidenceFileDigest];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (!isDeepStrictEqual(actual, canonical)) {
    throw new AuditEvidenceError(`${context} has unsupported or missing fields`);
  }
}

function assertDateTime(value: unknown, context: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !DATE_TIME_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new AuditEvidenceError(`${context} must be a valid date-time string`);
  }
}

function assertSafeFileName(value: unknown, context: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value === '.' ||
    value === '..' ||
    basename(value) !== value ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new AuditEvidenceError(`${context} must be a safe sibling file name`);
  }
}

function parseFileDigest(value: unknown, expectedKind: EvidenceFileKind): EvidenceFileDigest {
  if (!isObject(value)) {
    throw new AuditEvidenceError(`manifest ${expectedKind} file entry must be an object`);
  }
  assertExactKeys(value, ['kind', 'path', 'byteLength', 'algorithm', 'digest'], 'file entry');
  if (value.kind !== expectedKind) {
    throw new AuditEvidenceError(`manifest file entries must remain ordered history then summary`);
  }
  assertSafeFileName(value.path, `${expectedKind} path`);
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0) {
    throw new AuditEvidenceError(`${expectedKind} byteLength must be a non-negative integer`);
  }
  if (value.algorithm !== EVIDENCE_DIGEST_ALGORITHM) {
    throw new AuditEvidenceError(`${expectedKind} digest algorithm is unsupported`);
  }
  if (typeof value.digest !== 'string' || !SHA256_PATTERN.test(value.digest)) {
    throw new AuditEvidenceError(`${expectedKind} digest must be lowercase SHA-256 hex`);
  }
  return {
    kind: expectedKind,
    path: value.path,
    byteLength: value.byteLength as number,
    algorithm: EVIDENCE_DIGEST_ALGORITHM,
    digest: value.digest,
  };
}

function parseAuthentication(value: unknown): EvidenceManifestAuthentication {
  if (!isObject(value)) {
    throw new AuditEvidenceError('manifest authentication must be an object');
  }
  assertExactKeys(value, ['algorithm', 'keyId', 'signature'], 'manifest authentication');
  if (value.algorithm !== EVIDENCE_AUTHENTICATION_ALGORITHM) {
    throw new AuditEvidenceError('manifest authentication algorithm is unsupported');
  }
  if (typeof value.keyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.keyId)) {
    throw new AuditEvidenceError('manifest authentication keyId is malformed');
  }
  if (typeof value.signature !== 'string' || !SIGNATURE_PATTERN.test(value.signature)) {
    throw new AuditEvidenceError('manifest authentication signature is malformed');
  }
  return {
    algorithm: EVIDENCE_AUTHENTICATION_ALGORITHM,
    keyId: value.keyId,
    signature: value.signature,
  };
}

export function parseEvidenceManifest(contents: string): EvidenceManifest {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch (error) {
    throw new AuditEvidenceError('evidence manifest is not valid JSON', error);
  }
  if (!isObject(value)) {
    throw new AuditEvidenceError('evidence manifest must be an object');
  }
  const hasAuthentication = Object.hasOwn(value, 'authentication');
  assertExactKeys(
    value,
    hasAuthentication
      ? ['schemaVersion', 'generatedAt', 'files', 'authentication']
      : ['schemaVersion', 'generatedAt', 'files'],
    'evidence manifest',
  );
  if (value.schemaVersion !== EVIDENCE_MANIFEST_SCHEMA_VERSION) {
    throw new AuditEvidenceError('evidence manifest schemaVersion is unsupported');
  }
  assertDateTime(value.generatedAt, 'manifest generatedAt');
  if (!Array.isArray(value.files) || value.files.length !== 2) {
    throw new AuditEvidenceError('evidence manifest must contain exactly two ordered files');
  }
  const files = [
    parseFileDigest(value.files[0], 'history'),
    parseFileDigest(value.files[1], 'summary'),
  ] as const;
  if (files[0].path === files[1].path) {
    throw new AuditEvidenceError('evidence manifest files must have different paths');
  }
  return {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    files,
    ...(hasAuthentication ? { authentication: parseAuthentication(value.authentication) } : {}),
  };
}

function unsignedManifest(manifest: EvidenceManifest): UnsignedEvidenceManifest {
  return {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    files: manifest.files,
  };
}

function authenticationPayload(manifest: UnsignedEvidenceManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

function assertAuthenticationKey(key: Uint8Array): void {
  if (key.byteLength < MINIMUM_EVIDENCE_KEY_BYTES) {
    throw new AuditEvidenceError(
      `evidence authentication keys must contain at least ${String(MINIMUM_EVIDENCE_KEY_BYTES)} bytes`,
    );
  }
}

function digest(contents: string): string {
  return createHash(EVIDENCE_DIGEST_ALGORITHM).update(contents, 'utf8').digest('hex');
}

function fileDigest(kind: EvidenceFileKind, path: string, contents: string): EvidenceFileDigest {
  return {
    kind,
    path: basename(path),
    byteLength: Buffer.byteLength(contents, 'utf8'),
    algorithm: EVIDENCE_DIGEST_ALGORITHM,
    digest: digest(contents),
  };
}

function parseMatchingEvidence(
  historyContents: string,
  summaryContents: string,
): { readonly eventCount: number; readonly summary: AuditEvidenceSummary } {
  const events = parseAuditHistory(historyContents);
  if (historyContents !== serializeAuditHistory(events)) {
    throw new AuditEvidenceError('audit history is reordered or not canonical');
  }
  let value: unknown;
  try {
    value = JSON.parse(summaryContents) as unknown;
  } catch (error) {
    throw new AuditEvidenceError('audit evidence summary is not valid JSON', error);
  }
  if (!isObject(value) || typeof value.generatedAt !== 'string') {
    throw new AuditEvidenceError('audit evidence summary is malformed');
  }
  const expected = createAuditEvidenceSummary(events, value.generatedAt);
  if (!isDeepStrictEqual(value, expected)) {
    throw new AuditEvidenceError('audit evidence summary does not match canonical history');
  }
  return { eventCount: events.length, summary: expected };
}

function createManifest(
  historyPath: string,
  historyContents: string,
  summaryPath: string,
  summaryContents: string,
  summary: AuditEvidenceSummary,
  authentication?: EvidenceManifestAuthenticationInput,
): EvidenceManifest {
  const base: UnsignedEvidenceManifest = {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    generatedAt: summary.generatedAt,
    files: [
      fileDigest('history', historyPath, historyContents),
      fileDigest('summary', summaryPath, summaryContents),
    ],
  };
  if (authentication === undefined) return base;
  assertAuthenticationKey(authentication.key);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(authentication.keyId)) {
    throw new AuditEvidenceError('evidence authentication keyId is malformed');
  }
  const signature = createHmac(EVIDENCE_DIGEST_ALGORITHM, authentication.key)
    .update(authenticationPayload(base))
    .digest('base64url');
  return {
    ...base,
    authentication: {
      algorithm: EVIDENCE_AUTHENTICATION_ALGORITHM,
      keyId: authentication.keyId,
      signature,
    },
  };
}

async function refuseSymbolicLink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new AuditEvidenceError(`refusing to overwrite symbolic link "${path}"`);
    }
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

export async function writeEvidenceManifest(
  options: WriteEvidenceManifestOptions,
): Promise<EvidenceManifest> {
  const historyPath = resolve(options.historyPath);
  const summaryPath = resolve(options.summaryPath);
  const manifestPath = resolve(options.manifestPath);
  const evidenceDirectory = dirname(historyPath);
  if (dirname(summaryPath) !== evidenceDirectory || dirname(manifestPath) !== evidenceDirectory) {
    throw new AuditEvidenceError('history, summary, and manifest must be sibling files');
  }
  if (new Set([historyPath, summaryPath, manifestPath]).size !== 3) {
    throw new AuditEvidenceError('history, summary, and manifest paths must be different');
  }
  const [historyContents, summaryContents] = await Promise.all([
    readFile(historyPath, 'utf8'),
    readFile(summaryPath, 'utf8'),
  ]);
  const { summary } = parseMatchingEvidence(historyContents, summaryContents);
  const manifest = createManifest(
    historyPath,
    historyContents,
    summaryPath,
    summaryContents,
    summary,
    options.authentication,
  );
  if (options.force === true) await refuseSymbolicLink(manifestPath);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: options.force === true ? 'w' : 'wx',
    mode: 0o600,
  });
  return manifest;
}

function verifyDigest(expected: EvidenceFileDigest, contents: string, history: boolean): void {
  const actualLength = Buffer.byteLength(contents, 'utf8');
  if (actualLength < expected.byteLength) {
    throw new AuditEvidenceError(`${expected.kind} evidence is truncated`);
  }
  if (actualLength > expected.byteLength) {
    throw new AuditEvidenceError(`${expected.kind} evidence length has changed`);
  }
  if (digest(contents) === expected.digest) return;
  if (history) {
    try {
      const events = parseAuditHistory(contents);
      if (contents !== serializeAuditHistory(events)) {
        throw new AuditEvidenceError('history evidence is reordered or not canonical');
      }
    } catch (error) {
      if (error instanceof AuditEvidenceError) throw error;
    }
  }
  throw new AuditEvidenceError(`${expected.kind} evidence was replaced or modified`);
}

function verifyAuthentication(
  manifest: EvidenceManifest,
  options: VerifyEvidenceManifestOptions,
): boolean {
  const authentication = manifest.authentication;
  if (authentication === undefined) {
    if (options.requireAuthenticated === true) {
      throw new AuditEvidenceError('an authenticated evidence manifest is required');
    }
    if (options.key !== undefined || options.expectedKeyId !== undefined) {
      throw new AuditEvidenceError('evidence manifest is unsigned; supplied key was not used');
    }
    return false;
  }
  if (options.key === undefined) {
    throw new AuditEvidenceError('authenticated evidence manifest requires a verification key');
  }
  assertAuthenticationKey(options.key);
  if (options.expectedKeyId !== undefined && options.expectedKeyId !== authentication.keyId) {
    throw new AuditEvidenceError(
      `evidence keyId mismatch: expected "${options.expectedKeyId}", received "${authentication.keyId}"`,
    );
  }
  const expected = createHmac(EVIDENCE_DIGEST_ALGORITHM, options.key)
    .update(authenticationPayload(unsignedManifest(manifest)))
    .digest();
  const received = Buffer.from(authentication.signature, 'base64url');
  if (received.byteLength !== expected.byteLength || !timingSafeEqual(received, expected)) {
    throw new AuditEvidenceError('evidence manifest authentication failed');
  }
  return true;
}

export async function verifyEvidenceManifest(
  options: VerifyEvidenceManifestOptions,
): Promise<VerifiedEvidenceManifest> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = parseEvidenceManifest(await readFile(manifestPath, 'utf8'));
  const authenticated = verifyAuthentication(manifest, options);
  const directory = dirname(manifestPath);
  const history = manifest.files[0];
  const summaryFile = manifest.files[1];
  let historyContents: string;
  let summaryContents: string;
  try {
    [historyContents, summaryContents] = await Promise.all([
      readFile(resolve(directory, history.path), 'utf8'),
      readFile(resolve(directory, summaryFile.path), 'utf8'),
    ]);
  } catch (error) {
    throw new AuditEvidenceError(
      'evidence manifest references a missing or unreadable file',
      error,
    );
  }
  verifyDigest(history, historyContents, true);
  verifyDigest(summaryFile, summaryContents, false);
  const verified = parseMatchingEvidence(historyContents, summaryContents);
  if (manifest.generatedAt !== verified.summary.generatedAt) {
    throw new AuditEvidenceError('manifest generatedAt does not match the evidence summary');
  }
  return {
    manifest,
    summary: verified.summary,
    authenticated,
    eventCount: verified.eventCount,
  };
}
