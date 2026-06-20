import { LoginRateLimitService } from '@/modules/auth/services/login-rate-limit.service';

class FakeRedisClient {
  private readonly counters = new Map<string, number>();

  mget(...keys: string[]) {
    return Promise.resolve(
      keys.map((key) => this.counters.get(key)?.toString() ?? null),
    );
  }

  del(key: string) {
    this.counters.delete(key);
    return Promise.resolve(1);
  }

  multi() {
    const increments: string[] = [];
    return {
      incr: (key: string) => increments.push(key),
      expire: () => undefined,
      exec: async () => {
        for (const key of increments) {
          this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
        }
        return [];
      },
    };
  }
}

describe(LoginRateLimitService.name, () => {
  it('blocks the administrator account after five failed attempts', async () => {
    const redis = new FakeRedisClient();
    const service = new LoginRateLimitService({
      getClient: () => redis,
    } as never);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.recordFailure('Admin@Example.com', '10.0.0.1');
    }

    await expect(
      service.isBlocked('admin@example.com', '10.0.0.2'),
    ).resolves.toBe(true);
  });

  it('clears the account limit after a successful login', async () => {
    const redis = new FakeRedisClient();
    const service = new LoginRateLimitService({
      getClient: () => redis,
    } as never);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.recordFailure('admin@example.com', `10.0.0.${attempt}`);
    }
    await service.resetAccount('admin@example.com');

    await expect(
      service.isBlocked('admin@example.com', '10.0.1.1'),
    ).resolves.toBe(false);
  });
});
