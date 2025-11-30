import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CommandBus } from '@nestjs/cqrs';
import { OperationResultDto } from '../../../common/dto/operation-result.dto';

@Controller('DataMigration/AccountReceivable')
@ApiTags('Data Migration - Account Receivable')
@UseInterceptors(ClassSerializerInterceptor)
export class AccountReceivableController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('Freight-Document')
  @ApiOperation({
    summary: 'Format and validate Account Receivable Freight entries from Excel file',
  })
  @ApiResponse({ status: 200, description: 'Entries formatted and validated successfully' })
  async uploadAccountReceivableFreightAsync(
    @Body() input: any,
  ): Promise<OperationResultDto<any>> {
    // Implementation with CQRS command
    return OperationResultDto.success({});
  }
}

