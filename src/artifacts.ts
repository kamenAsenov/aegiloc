import { mkdir } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';

import type { Page } from '@playwright/test';

import type { TargetAction } from './types.js';

export type ScreenshotPhase = 'before' | 'after';

export interface CapturedScreenshot {
  readonly phase: ScreenshotPhase;
  readonly name: string;
  readonly filePath: string;
  readonly auditPath: string;
  readonly contentType: 'image/png';
}

export interface ScreenshotCaptureOptions {
  readonly eventId: string;
  readonly targetKey: string;
  readonly action: TargetAction;
  readonly phase: ScreenshotPhase;
}

export interface ScreenshotCapture {
  capture(options: ScreenshotCaptureOptions): Promise<CapturedScreenshot>;
}

function safeSegment(value: string): string {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return (segment === '' ? 'target' : segment).slice(0, 80);
}

function safeAuditPath(filePath: string): string {
  if (!isAbsolute(filePath)) {
    return filePath;
  }

  const workspaceRelative = relative(process.cwd(), filePath);
  return workspaceRelative.startsWith('..') || isAbsolute(workspaceRelative)
    ? basename(filePath)
    : workspaceRelative;
}

export class FileScreenshotCapture implements ScreenshotCapture {
  public constructor(
    private readonly page: Page,
    private readonly directory: string,
  ) {}

  public async capture({
    eventId,
    targetKey,
    action,
    phase,
  }: ScreenshotCaptureOptions): Promise<CapturedScreenshot> {
    await mkdir(this.directory, { recursive: true });
    const name = `${safeSegment(targetKey)}-${action}-${safeSegment(eventId)}-${phase}.png`;
    const filePath = join(this.directory, name);
    const sensitiveFormControls = this.page.locator(
      [
        'input:not([type])',
        'input[type="email"]',
        'input[type="number"]',
        'input[type="password"]',
        'input[type="search"]',
        'input[type="tel"]',
        'input[type="text"]',
        'input[type="url"]',
        'textarea',
        '[contenteditable="true"]',
      ].join(', '),
    );
    await this.page.screenshot({
      path: filePath,
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      mask: [sensitiveFormControls],
      maskColor: '#6d5dfc',
    });

    return {
      phase,
      name,
      filePath,
      auditPath: safeAuditPath(filePath),
      contentType: 'image/png',
    };
  }
}
