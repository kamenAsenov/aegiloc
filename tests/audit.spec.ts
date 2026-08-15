import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  CompositeAuditSink,
  InMemoryAuditSink,
  JsonlAuditSink,
  PlaywrightAttachmentAuditSink,
  assessCandidates,
  createHealingAuditEvent,
  createHealingExecutionAuditEvent,
  type HealingAuditEvent,
} from '../src/index.js';

function auditEvent(): HealingAuditEvent {
  const assessment = assessCandidates([], {
    enabled: true,
    confidenceThreshold: 0.9,
    minimumScoreMargin: 0.15,
  });

  return createHealingAuditEvent({
    eventId: 'event-1',
    timestamp: '2026-08-15T00:00:00.000Z',
    mode: 'observe',
    modeDecision: 'observed',
    targetKey: 'checkout.placeOrder',
    action: 'click',
    primaryLocator: { type: 'role', role: 'button', name: 'Place order' },
    primaryError: new Error('sensitive details are not serialized'),
    collectionStatus: 'completed',
    assessment,
    rankedCandidates: [],
  });
}

test('writes one valid JSON object per JSONL line', async ({ browserName }, testInfo) => {
  void browserName;
  const filePath = testInfo.outputPath('healwright', 'history.jsonl');
  const sink = new JsonlAuditSink(filePath);

  await sink.write(auditEvent());

  const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? '')).toMatchObject({
    schemaVersion: 1,
    eventId: 'event-1',
    targetKey: 'checkout.placeOrder',
  });
  expect(lines[0]).not.toContain('sensitive details');
});

test('fans out events to multiple sinks in order', async () => {
  const first = new InMemoryAuditSink();
  const second = new InMemoryAuditSink();
  const sink = new CompositeAuditSink([first, second]);

  await sink.write(auditEvent());

  expect(first.events).toEqual([auditEvent()]);
  expect(second.events).toEqual([auditEvent()]);
});

test('attaches structured JSON through the public Playwright API', async ({
  browserName,
}, testInfo) => {
  void browserName;
  const sink = new PlaywrightAttachmentAuditSink(testInfo);

  await sink.write(auditEvent());

  expect(testInfo.attachments.at(-1)).toMatchObject({
    name: 'healwright-event-1',
    contentType: 'application/json',
  });
});

test('execution events reference safe screenshot paths without serializing absolute paths', () => {
  const event = createHealingExecutionAuditEvent({
    eventId: 'execution-1',
    timestamp: '2026-08-15T00:00:01.000Z',
    parentEventId: 'event-1',
    targetKey: 'checkout.terms',
    action: 'check',
    candidateId: 'input:accept-terms:0',
    status: 'succeeded',
    reason: 'succeeded',
    screenshots: [
      {
        phase: 'before',
        name: 'before.png',
        filePath: '/Users/example/private/before.png',
        auditPath: 'test-results/healwright/before.png',
        contentType: 'image/png',
      },
    ],
  });

  expect(event).toMatchObject({
    eventType: 'locator-heal-execution',
    parentEventId: 'event-1',
    status: 'succeeded',
    screenshots: [
      {
        phase: 'before',
        path: 'test-results/healwright/before.png',
      },
    ],
  });
  expect(JSON.stringify(event)).not.toContain('/Users/example/private');
});
