import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import {
  CreateSettingHandler,
  UpdateSettingHandler,
  UpdateSettingValueHandler,
} from './commands/handlers';
import { GetSettingHandler, GetAllSettingsHandler } from './queries/handlers';
import { SettingsSeedService } from './services/settings-seed.service';
import { SettingsController } from './settings.controller';

const CommandHandlers = [
  CreateSettingHandler,
  UpdateSettingHandler,
  UpdateSettingValueHandler,
];

const QueryHandlers = [GetSettingHandler, GetAllSettingsHandler];

@Module({
  imports: [CqrsModule.forRoot()],
  controllers: [SettingsController],
  providers: [...CommandHandlers, ...QueryHandlers, SettingsSeedService],
})
export class SettingsModule {}
