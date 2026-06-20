import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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

  @Get(':eventId')
  get(@Param('eventId') eventId: string) {
    return this.logs.get(eventId);
  }
}
