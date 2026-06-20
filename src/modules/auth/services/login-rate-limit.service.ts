import { Injectable } from '@nestjs/common';

import { LogStreamService } from '@/modules/observability/services/log-stream.service';

@Injectable()
export class LoginRateLimitService {
  constructor(private readonly redis: LogStreamService) {}

  async isBlocked(email: string, ip: string): Promise<boolean> {
    const client = this.redis.getClient();
    const [account, address] = await client.mget(
      this.accountKey(email),
      this.ipKey(ip),
    );
    return Number(account ?? 0) >= 5 || Number(address ?? 0) >= 20;
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const client = this.redis.getClient();
    const keys = [this.accountKey(email), this.ipKey(ip)];
    const transaction = client.multi();
    for (const key of keys) {
      transaction.incr(key);
      transaction.expire(key, 15 * 60);
    }
    await transaction.exec();
  }

  async resetAccount(email: string): Promise<void> {
    await this.redis.getClient().del(this.accountKey(email));
  }

  private accountKey(email: string): string {
    return `auth:login:account:${email.trim().toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `auth:login:ip:${ip || 'unknown'}`;
  }
}
