import { Controller, Version } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

/**
 * Base controller decorator for API v1 controllers
 */
export function ApiV1Controller(route: string = '') {
  return function <T extends new (...args: any[]) => {}>(constructor: T) {
    Controller(`api/v1/${route}`)(constructor);
    Version('1')(constructor);
    ApiBearerAuth()(constructor);
  };
}

