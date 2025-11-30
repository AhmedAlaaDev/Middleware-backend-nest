import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  enabled?: boolean;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly defaultTimeout: number;
  private readonly defaultResetTimeout: number;
  private readonly defaultErrorThreshold: number;
  private breakers: Map<string, CircuitBreaker> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.defaultTimeout = this.configService.get<number>(
      'resilience.circuitBreaker.timeout',
      30000,
    );
    this.defaultResetTimeout = this.configService.get<number>(
      'resilience.circuitBreaker.resetTimeout',
      30000,
    );
    this.defaultErrorThreshold = this.configService.get<number>(
      'resilience.circuitBreaker.errorThresholdPercentage',
      50,
    );
  }

  createCircuitBreaker<T>(
    name: string,
    fn: (...args: any[]) => Promise<T>,
    options?: CircuitBreakerOptions,
  ): CircuitBreaker {
    if (this.breakers.has(name)) {
      return this.breakers.get(name)!;
    }

    const defaultOptions: CircuitBreakerOptions = {
      timeout: options?.timeout || this.defaultTimeout,
      errorThresholdPercentage: options?.errorThresholdPercentage || this.defaultErrorThreshold,
      resetTimeout: options?.resetTimeout || this.defaultResetTimeout,
      enabled: options?.enabled !== false,
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

  getCircuitBreaker(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  async execute<T>(
    name: string,
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    let breaker = this.getCircuitBreaker(name);
    if (!breaker) {
      breaker = this.createCircuitBreaker(name, fn);
    }
    return breaker.fire(...args);
  }
}

