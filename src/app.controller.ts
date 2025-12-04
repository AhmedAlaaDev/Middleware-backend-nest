import { Controller, Get } from '@nestjs/common';

@Controller('test')
export class AppController {
  constructor() {}

  @Get()
  getHello(): string {
    return 'NestJS is up and running!';
  }
}
