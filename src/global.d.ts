import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';

import { IUser } from '@/modules/user/interfaces/user.interface';

declare module 'express' {
  interface Request {
    // Add the user property to the Request object
    user: Omit<IUser, 'passwordHash'>;
  }
}

declare global {
  type Req = ExpressRequest;
  type Res = ExpressResponse;
  type MulterFile = Express.Multer.File;
  type Auth = Omit<IUser, 'passwordHash'>;
}

declare module 'fast-levenshtein' {
  const levenshtein: {
    get(
      left: string,
      right: string,
      options?: { useCollator?: boolean },
    ): number;
  };
  export default levenshtein;
}
