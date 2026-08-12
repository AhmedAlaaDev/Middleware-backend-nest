import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Public } from '@/modules/auth/decorators/public.decorator';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { ApplicationLogFiltersDto } from '@/modules/observability/dto/application-log-filters.dto';
import { ApplicationLogQueryService } from '@/modules/observability/services/application-log-query.service';
import { UserRole } from '@/modules/user/schemas/user.schema';

@ApiBearerAuth()
@ApiTags('Observability')
@Controller('observability/logs')
@Roles(UserRole.ADMIN)
export class ObservabilityLogsController {
  constructor(private readonly logs: ApplicationLogQueryService) {}

  @Get()
  list(@Query() filters: ApplicationLogFiltersDto) {
    return this.logs.listOffset(filters);
  }

  @Delete()
  clear(@Query() filters: ApplicationLogFiltersDto) {
    const { confirmAll, ...rest } = filters;
    return this.logs.deleteMatchingExplorer(rest, confirmAll);
  }

  @Get('batch/:batchId')
  @Public()
  getLogsByBatchId(@Param('batchId') batchId: string) {
    return this.logs.getLogsByBatchId(batchId);
  }


  @Get(':eventId')
  get(@Param('eventId') eventId: string) {
    return this.logs.get(eventId);
  }

  @Delete(':eventId')
  delete(@Param('eventId') eventId: string) {
    return this.logs.delete(eventId);
  }
}

