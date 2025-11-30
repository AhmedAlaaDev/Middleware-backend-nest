import { Module } from '@nestjs/common';
import { MasterDataService } from './services/master-data.service';
import { MasterDataController } from './controllers/master-data.controller';
import { DatabaseModule } from '../database/database.module';
import { CacheModule as AppCacheModule } from '../cache/cache.module';
import { D365FOModule } from '../d365fo/d365fo.module';

@Module({
  imports: [DatabaseModule, AppCacheModule, D365FOModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
