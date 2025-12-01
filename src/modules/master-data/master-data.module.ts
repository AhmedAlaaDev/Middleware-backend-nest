import { Module } from '@nestjs/common';

import { D365FOModule } from '@/modules/d365fo/d365fo.module';
import { MasterDataController } from '@/modules/master-data/master-data.controller';
import { MasterDataService } from '@/modules/master-data/master-data.service';

@Module({
  imports: [D365FOModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
})
export class MasterDataModule {}
