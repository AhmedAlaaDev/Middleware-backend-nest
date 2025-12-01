import { Module } from '@nestjs/common';

import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';
import { D365FODataService } from '@/modules/d365fo/services/d365fo-data.service';

@Module({
  providers: [D365FOAuthService, D365FODataService],
  exports: [D365FOAuthService, D365FODataService],
})
export class D365FOModule {}
