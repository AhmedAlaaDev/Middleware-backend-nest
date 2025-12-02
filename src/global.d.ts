import { User } from 'generated/prisma';

import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';

declare module 'express' {
  interface Request {
    // Add the user property to the Request object
    user: Omit<User, 'passwordHash'>;
  }
}

declare global {
  type Req = ExpressRequest;
  type Res = ExpressResponse;
  type MulterFile = Express.Multer.File;
  type Auth = Omit<User, 'passwordHash'>;
}
