import { Command } from '@nestjs/cqrs';

export class DeleteSettingCommand extends Command<{ success: boolean }> {
  constructor(public readonly logicalName: string) {
    super();
  }
}

