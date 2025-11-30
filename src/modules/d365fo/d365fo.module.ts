import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { D365FOAuthService } from './services/d365fo-auth.service';
import { D365FODataService } from './services/d365fo-data.service';
import { CacheModule as AppCacheModule } from '../cache/cache.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    HttpModule.registerAsync({
      useFactory: () => ({
        timeout: 30000,
        maxRedirects: 5,
      }),
    }),
    AppCacheModule,
    CommonModule,
  ],
  providers: [D365FOAuthService, D365FODataService],
  exports: [D365FOAuthService, D365FODataService],
})
export class D365FOModule {}

