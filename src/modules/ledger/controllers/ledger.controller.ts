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

@Controller('DataMigration/Ledger')
@ApiTags('Data Migration - Ledger')
@UseInterceptors(ClassSerializerInterceptor)
export class LedgerController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('Freight-Closing-Document')
  @ApiOperation({
    summary: 'Format and validate Ledger Freight Closing entries from Excel file',
  })
  @ApiResponse({ status: 200, description: 'Entries formatted and validated successfully' })
  async uploadLedgerFreightClosingAsync(
    @Body() input: any,
  ): Promise<OperationResultDto<any>> {
    // Implementation with CQRS command
    return OperationResultDto.success({});
  }
}

