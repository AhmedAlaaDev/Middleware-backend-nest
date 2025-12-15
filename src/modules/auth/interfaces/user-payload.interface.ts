import { IUser } from '@/modules/user/interfaces/user.interface';

export type UserPayload = Pick<
  IUser,
  'firstName' | 'lastName' | 'email' | 'role' | 'avatarPath'
> & { sub: string };
