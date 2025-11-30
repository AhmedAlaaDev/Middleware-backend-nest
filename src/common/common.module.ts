import { Global, Module } from '@nestjs/common';
import { WinstonLoggerService } from './logger/winston-logger.service';
import { CircuitBreakerService } from './resilience/circuit-breaker.service';
import { RetryService } from './resilience/retry.service';

@Global()
@Module({
  providers: [WinstonLoggerService, CircuitBreakerService, RetryService],
  exports: [WinstonLoggerService, CircuitBreakerService, RetryService],
})
export class CommonModule {}

