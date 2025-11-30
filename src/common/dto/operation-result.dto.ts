import { ApiProperty } from '@nestjs/swagger';

export class OperationResultDto<T = any> {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ required: false })
  data?: T;

  @ApiProperty({ required: false })
  message?: string;

  @ApiProperty({ required: false })
  code?: number;

  @ApiProperty({ required: false })
  errors?: string[];

  static success<T>(data?: T, message?: string): OperationResultDto<T> {
    return {
      success: true,
      data,
      message,
    };
  }

  static failure<T>(
    message: string,
    code?: number,
    errors?: string[],
  ): OperationResultDto<T> {
    return {
      success: false,
      message,
      code,
      errors,
    };
  }
}

