import { registerAs } from '@nestjs/config';

export interface ResilienceConfig {
  /** Default Axios timeout for outbound HTTP (including D365FO). */
  httpTimeout: number;
  /**
   * Axios timeout for large D365FO custom-service mutations (cash-out bulk).
   * Onebox/sandbox TTS for ~100 journal lines routinely exceeds 2 minutes.
   */
  bulkHttpTimeout: number;
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
  };
}

export const resilienceConfig = registerAs(
  'resilience',
  (): ResilienceConfig => ({
    httpTimeout: parseInt(process.env.HTTP_TIMEOUT ?? '120000', 10),
    bulkHttpTimeout: parseInt(
      process.env.D365FO_BULK_HTTP_TIMEOUT ??
        process.env.HTTP_TIMEOUT ??
        '600000',
      10,
    ),
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
    },
  }),
);
