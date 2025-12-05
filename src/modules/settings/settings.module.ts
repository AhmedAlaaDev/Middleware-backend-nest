import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { UpdateSettingValueHandler } from './commands/handlers';
import { GetSettingHandler, GetAllSettingsHandler } from './queries/handlers';
import { SettingsSeedService } from './services/settings-seed.service';
import { SettingsController } from './settings.controller';

const CommandHandlers = [UpdateSettingValueHandler];

const QueryHandlers = [GetSettingHandler, GetAllSettingsHandler];

@Module({
  imports: [CqrsModule.forRoot()],
  controllers: [SettingsController],
  providers: [...CommandHandlers, ...QueryHandlers, SettingsSeedService],
})
export class SettingsModule {}
