import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IConfig, ObservabilityConfig } from '@/config';
import {
  JsonSafeValue,
  OperationalLogBodySnapshot,
  OperationalLogPayload,
} from '@/modules/observability/interfaces/operational-log.interface';

const REDACTED = '[redacted]';

/**
 * Keys whose values never reach the log store, matched case-insensitively
 * against the raw key name.
 */
const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /authorization/i,
  /^cookies?$/i,
  /set-cookie/i,
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /credential/i,
  /api[-_]?key/i,
  /connection[-_]?string/i,
];

/**
 * Progressive truncation steps applied, in order, to a payload that exceeds
 * the capture budget: each pair caps array length and string length.
 */
const TRUNCATION_STEPS: Array<{ arrayLimit: number; stringLimit: number }> = [
  { arrayLimit: 500, stringLimit: 8192 },
  { arrayLimit: 200, stringLimit: 4096 },
  { arrayLimit: 100, stringLimit: 2048 },
  { arrayLimit: 50, stringLimit: 1024 },
  { arrayLimit: 20, stringLimit: 512 },
  { arrayLimit: 10, stringLimit: 256 },
  { arrayLimit: 5, stringLimit: 128 },
  { arrayLimit: 1, stringLimit: 128 },
];

/**
 * Turns arbitrary request/response bodies into a JSON-safe, secret-free,
 * size-bounded snapshot that can be pushed through the Redis log stream and
 * stored as a Mongo document.
 */
@Injectable()
export class LogPayloadService {
  private readonly config: ObservabilityConfig;

  constructor(configService: ConfigService<IConfig>) {
    this.config =
      configService.getOrThrow<ObservabilityConfig>('observability');
  }

  get enabled(): boolean {
    return this.config.capturePayloads;
  }

  /**
   * Capture a single body. Returns `undefined` when capture is disabled or
   * there is nothing to capture, so callers can spread the result safely.
   */
  capture(value: unknown): OperationalLogBodySnapshot | undefined {
    if (!this.enabled || value === undefined) return undefined;

    try {
      const redactedKeys = new Set<string>();
      const normalized = this.normalize(value, new WeakSet(), 0, redactedKeys);
      const sizeBytes = this.byteLength(normalized);
      const withinBudget = sizeBytes <= this.config.payloadMaxBytes;

      return {
        body: withinBudget ? normalized : this.fitToBudget(normalized),
        sizeBytes,
        truncated: !withinBudget,
        ...(redactedKeys.size > 0
          ? { redactedKeys: [...redactedKeys].sort() }
          : {}),
      };
    } catch (error) {
      return {
        body: null,
        sizeBytes: 0,
        truncated: false,
        captureError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Capture both sides of a call. Returns `undefined` when neither side
   * produced a snapshot.
   */
  captureExchange(
    request: unknown,
    response?: unknown,
  ): OperationalLogPayload | undefined {
    const requestSnapshot = this.capture(request);
    const responseSnapshot = this.capture(response);
    if (!requestSnapshot && !responseSnapshot) return undefined;

    return {
      ...(requestSnapshot ? { request: requestSnapshot } : {}),
      ...(responseSnapshot ? { response: responseSnapshot } : {}),
    };
  }

  private normalize(
    value: unknown,
    seen: WeakSet<object>,
    depth: number,
    redactedKeys: Set<string>,
  ): JsonSafeValue {
    if (value === null || value === undefined) return null;

    switch (typeof value) {
      case 'string':
        return this.capString(value, this.config.payloadMaxStringLength);
      case 'number':
        return Number.isFinite(value) ? value : String(value);
      case 'boolean':
        return value;
      case 'bigint':
        return `${value.toString()}n`;
      case 'function':
        return `[function ${value.name || 'anonymous'}]`;
      case 'symbol':
        return value.toString();
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? 'Invalid Date'
        : value.toISOString();
    }
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        ...(value.stack ? { stack: value.stack } : {}),
      };
    }

    if (depth >= this.config.payloadMaxDepth) return '[depth limit exceeded]';

    const asObject = value as object;
    if (seen.has(asObject)) return '[circular]';
    seen.add(asObject);

    try {
      if (Array.isArray(value)) {
        return value.map((item) =>
          this.normalize(item, seen, depth + 1, redactedKeys),
        );
      }
      if (value instanceof Set) {
        return [...value].map((item) =>
          this.normalize(item, seen, depth + 1, redactedKeys),
        );
      }
      if (value instanceof Map) {
        return this.normalizeEntries(
          [...value.entries()].map(([key, item]) => [String(key), item]),
          seen,
          depth,
          redactedKeys,
        );
      }

      const serializable = value as { toJSON?: () => unknown };
      if (typeof serializable.toJSON === 'function') {
        return this.normalize(
          serializable.toJSON(),
          seen,
          depth + 1,
          redactedKeys,
        );
      }

      return this.normalizeEntries(
        Object.entries(value as Record<string, unknown>),
        seen,
        depth,
        redactedKeys,
      );
    } finally {
      seen.delete(asObject);
    }
  }

  private normalizeEntries(
    entries: Array<[string, unknown]>,
    seen: WeakSet<object>,
    depth: number,
    redactedKeys: Set<string>,
  ): JsonSafeValue {
    const result: Record<string, JsonSafeValue> = {};

    for (const [key, entryValue] of entries) {
      if (entryValue === undefined) continue;

      if (this.isSensitiveKey(key)) {
        redactedKeys.add(key);
        result[key] = REDACTED;
        continue;
      }

      result[key] = this.normalize(entryValue, seen, depth + 1, redactedKeys);
    }

    return result;
  }

  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
  }

  private fitToBudget(value: JsonSafeValue): JsonSafeValue {
    for (const { arrayLimit, stringLimit } of TRUNCATION_STEPS) {
      const shrunk = this.shrink(value, arrayLimit, stringLimit);
      if (this.byteLength(shrunk) <= this.config.payloadMaxBytes) return shrunk;
    }

    return {
      truncationNote:
        'Payload exceeded the log capture budget and could not be truncated to fit.',
    };
  }

  private shrink(
    value: JsonSafeValue,
    arrayLimit: number,
    stringLimit: number,
  ): JsonSafeValue {
    if (typeof value === 'string') return this.capString(value, stringLimit);

    if (Array.isArray(value)) {
      const kept = value
        .slice(0, arrayLimit)
        .map((item) => this.shrink(item, arrayLimit, stringLimit));
      const omitted = value.length - kept.length;
      return omitted > 0
        ? [...kept, `[+${omitted} more item(s) truncated]`]
        : kept;
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          key,
          this.shrink(entryValue, arrayLimit, stringLimit),
        ]),
      );
    }

    return value;
  }

  private capString(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}…[+${value.length - limit} chars truncated]`;
  }

  private byteLength(value: JsonSafeValue): number {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
  }
}
