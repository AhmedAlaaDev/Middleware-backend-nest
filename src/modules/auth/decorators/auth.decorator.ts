import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { IUser } from '@/modules/user/interfaces/user.interface';

// creates a decorator that can be used to extract the user from the request
export const Auth = createParamDecorator(
  (
    key: keyof Omit<IUser, 'passwordHash'> | undefined,
    ctx: ExecutionContext,
  ) => {
    const request = ctx.switchToHttp().getRequest<Req>();
    const user = request.user;

    if (key) {
      return user[key];
    }

    return user;
  },
);
