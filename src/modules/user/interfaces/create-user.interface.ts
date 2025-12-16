export interface ICreateUser {
  firstName?: string | undefined;
  lastName?: string | undefined;
  email: string;
  passwordHash: string;
}
