import { SetMetadata } from '@nestjs/common';

export const REQUIRE_API_KEY = 'requireApiKey';

/**
 * Decorator to mark endpoints as requiring API key authentication
 * Use this on controllers or specific endpoints that need admin/automation access
 *
 * @example
 * ```typescript
 * @Controller('scheduler')
 * @RequireApiKey()
 * export class SchedulerController {
 *   // All endpoints require API key
 * }
 * ```
 *
 * @example
 * ```typescript
 * @Post('cleanup')
 * @RequireApiKey()
 * async cleanup() {
 *   // Only this endpoint requires API key
 * }
 * ```
 */
export const RequireApiKey = () => SetMetadata(REQUIRE_API_KEY, true);
