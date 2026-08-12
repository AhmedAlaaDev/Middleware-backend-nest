import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '@/modules/auth/decorators/roles.decorator';
import {
  type ApplicationLogFilters,
  ApplicationLogQueryService,
} from '@/modules/observability/services/application-log-query.service';
import { UserRole } from '@/modules/user/schemas/user.schema';

@ApiBearerAuth()
@ApiTags('Admin Observability')
@Controller('admin/logs')
@Roles(UserRole.ADMIN)
export class AdminLogsController {
  constructor(private readonly logs: ApplicationLogQueryService) {}

  @Get()
  list(@Query() filters: ApplicationLogFilters) {
    return this.logs.list(filters);
  }

  @Delete()
  clear(@Query() filters: ApplicationLogFilters & { confirmAll?: string }) {
    const { confirmAll, ...rest } = filters;
    return this.logs.deleteMatchingLive(rest, confirmAll);
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
