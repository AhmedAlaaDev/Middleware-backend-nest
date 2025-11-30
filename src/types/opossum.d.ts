declare module 'opossum' {
  interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    enabled?: boolean;
    volumeThreshold?: number;
    rollingCountTimeout?: number;
    rollingCountBuckets?: number;
    name?: string;
    group?: string;
    errorFilter?: (error: Error) => boolean;
    cache?: boolean;
  }

  interface CircuitBreakerStats {
    fires: number;
    cacheHits: number;
    cacheMisses: number;
    fallbacks: number;
    successes: number;
    failures: number;
    rejects: number;
    timeouts: number;
    semaphoreRejects: number;
    percentiles: Record<string, number>;
    latencyTimes: number[];
    error: Error | null;
    opened: boolean;
    closed: boolean;
    halfOpen: boolean;
    isShutdown: boolean;
    lastTimer: number;
    state: {
      name: string;
      enabled: boolean;
      volumeThreshold: number;
      errorThresholdPercentage: number;
      timeout: number;
      resetTimeout: number;
      rollingCountTimeout: number;
      rollingCountBuckets: number;
      requestCount: number;
      errorCount: number;
      lastTimer: number;
      openedAt: number | null;
      closed: boolean;
      halfOpen: boolean;
      warmUp: boolean;
      volumeThresholdReached: boolean;
      errorThresholdReached: boolean;
    };
  }

  class CircuitBreaker<T = any, R = any> {
    constructor(
      action: (...args: any[]) => Promise<T>,
      options?: CircuitBreakerOptions,
    );

    fire(...args: any[]): Promise<T>;
    execute(...args: any[]): Promise<T>;
    open(): void;
    close(): void;
    halfOpen(): void;
    disable(): void;
    enable(): void;
    shutdown(): void;
    isOpen(): boolean;
    isClosed(): boolean;
    isHalfOpen(): boolean;
    getStats(): CircuitBreakerStats;
    on(event: string, listener: (...args: any[]) => void): void;
    removeListener(event: string, listener: (...args: any[]) => void): void;
    removeAllListeners(event?: string): void;
  }

  export = CircuitBreaker;
}

