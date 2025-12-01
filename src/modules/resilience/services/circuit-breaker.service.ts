import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';

import { IConfig, ResilienceConfig } from '@/config';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  enabled?: boolean;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor(private readonly configService: ConfigService<IConfig>) {}

  createCircuitBreaker<T>(
    name: string,
    fn: (...args: any[]) => Promise<T>,
    options?: CircuitBreakerOptions,
  ): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const { timeout, errorThresholdPercentage, resetTimeout, enabled } =
      this.circuitBreakerConfig;

    const defaultOptions: CircuitBreakerOptions = {
      timeout: options?.timeout || timeout,
      errorThresholdPercentage:
        options?.errorThresholdPercentage || errorThresholdPercentage,
      resetTimeout: options?.resetTimeout || resetTimeout,
      enabled: options?.enabled !== false || enabled,
    };

    const breaker = new CircuitBreaker(fn, {
      timeout: defaultOptions.timeout,
      errorThresholdPercentage: defaultOptions.errorThresholdPercentage,
      resetTimeout: defaultOptions.resetTimeout,
      enabled: defaultOptions.enabled,
    });

    breaker.on('open', () => {
      this.logger.warn(`Circuit breaker ${name} opened - too many failures`);
    });

    breaker.on('halfOpen', () => {
      this.logger.log(`Circuit breaker ${name} half-open - attempting reset`);
    });

    breaker.on('close', () => {
      this.logger.log(`Circuit breaker ${name} closed - normal operation`);
    });

    breaker.on('failure', (error: Error) => {
      this.logger.error(`Circuit breaker ${name} failure:`, error.message);
    });

    this.breakers.set(name, breaker);

    return breaker;
  }

  getCircuitBreaker(name: string) {
    return this.breakers.get(name);
  }

  public execute<T>(
    name: string,
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    let breaker = this.getCircuitBreaker(name);

    if (!breaker) {
      breaker = this.createCircuitBreaker(name, fn);
    }

    return breaker.fire(...args) as Promise<T>;
  }

  private get circuitBreakerConfig(): CircuitBreakerOptions {
    const config = this.configService.get<ResilienceConfig>('resilience');

    return {
      timeout: config?.circuitBreaker?.timeout,
      errorThresholdPercentage:
        config?.circuitBreaker?.errorThresholdPercentage,
      resetTimeout: config?.circuitBreaker?.resetTimeout,
      enabled: config?.circuitBreaker?.enabled,
    };
  }
}
