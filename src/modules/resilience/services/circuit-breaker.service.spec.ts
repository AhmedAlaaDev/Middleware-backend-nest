import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  const createService = (overrides: Record<string, unknown> = {}) =>
    new CircuitBreakerService({
      get: jest.fn().mockReturnValue({
        circuitBreaker: {
          timeout: 1000,
          resetTimeout: 1000,
          failureThreshold: 5,
          errorThresholdPercentage: 50,
          enabled: true,
          ...overrides,
        },
      }),
    } as any);

  it('does not open before the configured failure threshold is reached', async () => {
    const service = createService({ failureThreshold: 3 });
    const breaker = service.createCircuitBreaker(
      'repeated-upload-lookups',
      () => Promise.reject(new Error('temporary D365 failure')),
    );

    await expect(breaker.fire()).rejects.toThrow('temporary D365 failure');
    await expect(breaker.fire()).rejects.toThrow('temporary D365 failure');
    expect(breaker.opened).toBe(false);

    await expect(breaker.fire()).rejects.toThrow('temporary D365 failure');
    expect(breaker.opened).toBe(true);
    breaker.shutdown();
  });

  it('allows a later upload lookup to recover after two transient failures', async () => {
    const service = createService();
    const lookup = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary D365 failure'))
      .mockRejectedValueOnce(new Error('temporary D365 failure'))
      .mockResolvedValue('available');
    const breaker = service.createCircuitBreaker('third-upload-lookup', lookup);

    await expect(breaker.fire()).rejects.toThrow('temporary D365 failure');
    await expect(breaker.fire()).rejects.toThrow('temporary D365 failure');
    await expect(breaker.fire()).resolves.toBe('available');
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(breaker.opened).toBe(false);
    breaker.shutdown();
  });

  it('honors the configured disabled state', async () => {
    const service = createService({ enabled: false });
    const breaker = service.createCircuitBreaker('disabled-breaker', () =>
      Promise.reject(new Error('temporary D365 failure')),
    );

    await expect(breaker.fire()).rejects.toThrow('temporary D365 failure');
    expect(breaker.enabled).toBe(false);
    expect(breaker.opened).toBe(false);
    breaker.shutdown();
  });
});
