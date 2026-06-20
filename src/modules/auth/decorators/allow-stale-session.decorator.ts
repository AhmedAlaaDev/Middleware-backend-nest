import { SetMetadata } from '@nestjs/common';

export const ALLOW_STALE_SESSION = 'allowStaleSession';
export const AllowStaleSession = () => SetMetadata(ALLOW_STALE_SESSION, true);
