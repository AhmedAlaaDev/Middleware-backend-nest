import { Controller, Version, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

/**
 * Base controller decorator for API v1 controllers
 */
export function ApiV1Controller(route: string = '') {
  return applyDecorators(
    Controller(`api/v1/${route}`),
    Version('1'),
    ApiBearerAuth(),
  );
}

