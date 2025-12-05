import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { UpdateSettingValueHandler } from './commands/handlers/update-setting-value.handler';
import { SettingsController } from './settings.controller';
import {
  GetSettingHandler,
  GetAllSettingsHandler,
} from './queries/handlers';

const CommandHandlers = [UpdateSettingValueHandler];

const QueryHandlers = [GetSettingHandler, GetAllSettingsHandler];

@Module({
  imports: [CqrsModule.forRoot()],
  controllers: [SettingsController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class SettingsModule {}

