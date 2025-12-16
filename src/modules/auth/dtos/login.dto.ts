import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  /**
   * email should be a valid email address
   * @example test@test.com
   */
  @IsNotEmpty()
  @IsString()
  @Transform(({ value }: { value: string }) => value.toLowerCase())
  @IsEmail()
  email: string;

  /**
   * password used to authenticate the user
   * @example Password@1234
   */
  @IsNotEmpty()
  @IsString()
  password: string;
}
