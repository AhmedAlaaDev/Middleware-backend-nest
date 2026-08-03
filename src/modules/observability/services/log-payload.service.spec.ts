import { ConfigService } from '@nestjs/config';

import { IConfig, ObservabilityConfig } from '@/config';
import { LogPayloadService } from '@/modules/observability/services/log-payload.service';

describe('LogPayloadService', () => {
  function buildService(overrides: Partial<ObservabilityConfig> = {}) {
    const config = {
      capturePayloads: true,
      payloadMaxBytes: 1024 * 1024,
      payloadMaxStringLength: 32 * 1024,
      payloadMaxDepth: 12,
      ...overrides,
    } as ObservabilityConfig;

    return new LogPayloadService({
      getOrThrow: () => config,
    } as unknown as ConfigService<IConfig>);
  }

  it('captures a cash-out bulk body in full, including every line', () => {
    const service = buildService();
    const body = {
      _contract: {
        Lines: Array.from({ length: 25 }, (_, index) => ({
          journalNum: 'Mesco-000013758',
          AccountNum: `50${index}`,
          debitAmount: 5000 + index,
          transDate: new Date('2026-01-01T00:00:00.000Z'),
        })),
      },
    };

    const snapshot = service.capture(body);

    expect(snapshot?.truncated).toBe(false);
    const lines = (snapshot?.body as any)._contract.Lines;
    expect(lines).toHaveLength(25);
    expect(lines[24]).toEqual({
      journalNum: 'Mesco-000013758',
      AccountNum: '5024',
      debitAmount: 5024,
      transDate: '2026-01-01T00:00:00.000Z',
    });
    expect(snapshot?.sizeBytes).toBeGreaterThan(0);
  });

  it('redacts credential-bearing keys and reports which keys were hidden', () => {
    const service = buildService();

    const snapshot = service.capture({
      Authorization: 'Bearer abc.def',
      clientSecret: 'super-secret',
      nested: { access_token: 'xyz', AccountNum: '5019' },
    });

    expect(snapshot?.body).toEqual({
      Authorization: '[redacted]',
      clientSecret: '[redacted]',
      nested: { access_token: '[redacted]', AccountNum: '5019' },
    });
    expect(snapshot?.redactedKeys).toEqual([
      'Authorization',
      'access_token',
      'clientSecret',
    ]);
  });

  it('truncates oversized bodies and keeps the original size for reference', () => {
    const service = buildService({ payloadMaxBytes: 2048 });

    const snapshot = service.capture({
      Lines: Array.from({ length: 4000 }, (_, index) => ({
        lineNumber: index,
        text: 'x'.repeat(64),
      })),
    });

    expect(snapshot?.truncated).toBe(true);
    expect(snapshot?.sizeBytes).toBeGreaterThan(2048);
    const lines = (snapshot?.body as any).Lines as unknown[];
    expect(lines.length).toBeLessThan(4000);
    expect(lines.at(-1)).toMatch(/more item\(s\) truncated/);
  });

  it('survives circular references, buffers, and errors', () => {
    const service = buildService();
    const circular: Record<string, unknown> = { name: 'root' };
    circular.self = circular;

    const snapshot = service.capture({
      circular,
      file: Buffer.from('hello'),
      failure: new Error('boom'),
    });

    expect((snapshot?.body as any).circular).toEqual({
      name: 'root',
      self: '[circular]',
    });
    expect((snapshot?.body as any).file).toBe('[Buffer 5 bytes]');
    expect((snapshot?.body as any).failure.message).toBe('boom');
  });

  it('captures nothing when payload capture is disabled', () => {
    const service = buildService({ capturePayloads: false });

    expect(service.capture({ any: 'body' })).toBeUndefined();
    expect(
      service.captureExchange({ any: 'body' }, { ok: true }),
    ).toBeUndefined();
  });

  it('omits the side of an exchange that has no body', () => {
    const service = buildService();

    const payload = service.captureExchange(undefined, {
      StatusCode: 'Success',
    });

    expect(payload).toEqual({
      response: {
        body: { StatusCode: 'Success' },
        sizeBytes: expect.any(Number),
        truncated: false,
      },
    });
  });
});
