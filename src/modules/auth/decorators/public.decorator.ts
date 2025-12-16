import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// SetMetadata is a decorator that sets metadata on a class, method, or parameter. In this case, we are setting the metadata key 'isPublic' to true.
