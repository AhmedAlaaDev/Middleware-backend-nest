import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { D365FOAuthService } from './services/d365fo-auth.service';
import { D365FODataService } from './services/d365fo-data.service';
import { CacheModule as AppCacheModule } from '../cache/cache.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        timeout: configService.get<number>('resilience.timeout.requestTimeout', 30000),
        maxRedirects: configService.get<number>('http.maxRedirects', 5),
      }),
      inject: [ConfigService],
    }),
    AppCacheModule,
    CommonModule,
  ],
  providers: [D365FOAuthService, D365FODataService],
  exports: [D365FOAuthService, D365FODataService],
})
export class D365FOModule {}

