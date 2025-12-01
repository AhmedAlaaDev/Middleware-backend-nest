import { registerAs } from '@nestjs/config';

export interface ResilienceConfig {
  circuitBreaker: {
    timeout: number;
    resetTimeout: number;
    failureThreshold: number;
    errorThresholdPercentage: number;
    enabled: boolean;
  };
}

export const resilienceConfig = registerAs(
  'resilience',
  (): ResilienceConfig => ({
    circuitBreaker: {
      timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT ?? '30000', 10),
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
  }),
);
