import { registerAs } from '@nestjs/config';

export interface ResilienceConfig {
  circuitBreaker: {
    timeout: number;
    resetTimeout: number;
    failureThreshold: number;
    errorThresholdPercentage: number;
    enabled: boolean;
  };
  cache: {
    l1Ttl: number;
    l2Ttl: number;
    l3Ttl: number;
    redisEnabled: boolean;
  };
}

export const resilienceConfig = registerAs(
  'resilience',
  (): ResilienceConfig => ({
    circuitBreaker: {
      timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT ?? '60000', 10),
      resetTimeout: parseInt(
        process.env.CIRCUIT_BREAKER_RESET_TIMEOUT ?? '30000',
        10,
      ),
      failureThreshold: parseInt(
        process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? '5',
        10,
      ),
      errorThresholdPercentage: parseInt(
        process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE ?? '50',
        10,
      ),
      enabled: JSON.parse(process.env.CIRCUIT_BREAKER_ENABLED ?? 'true'),
    },
    cache: {
      l1Ttl: parseInt(process.env.CACHE_L1_TTL ?? '5', 10) * 60 * 1000, // 5 min,
      l2Ttl: parseInt(process.env.CACHE_L2_TTL ?? '30', 10) * 60 * 1000, // 30 min,
      l3Ttl: parseInt(process.env.CACHE_L3_TTL ?? '120', 10) * 60 * 1000, // 120 min,
      redisEnabled: JSON.parse(process.env.REDIS_ENABLED ?? 'false'),
    },
  }),
);
