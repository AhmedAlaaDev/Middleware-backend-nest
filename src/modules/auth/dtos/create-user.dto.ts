import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

import { titleCase } from '@/lib/utils';

export class CreateUserDto {
  /**
   * firstName should be at least 3 characters long and contain only alphabetic characters
   * @example Jone
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @Transform(({ value }: { value: string }) => titleCase(value))
  @Matches(/^[a-zA-Z]+$/, {
    message: 'firstName must contain only alphabetic characters',
  })
  firstName?: string;

  /**
   * lastName should be at least 3 characters long and contain only alphabetic characters
   * @example Doe
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @Transform(({ value }: { value: string }) => titleCase(value))
  @Matches(/^[a-zA-Z]+$/, {
    message: 'lastName must contain only alphabetic characters',
  })
  lastName?: string;

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
   * password should be at least 6 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character
   * @example Password@1234
   */
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&/])[A-Za-z\d@$!%*?&/]{6,}$/,
    {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    },
  )
  password: string;
}
