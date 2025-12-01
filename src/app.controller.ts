import { Controller, Get } from '@nestjs/common';

import { D365FOAuthService } from '@/modules/d365fo/services/d365fo-auth.service';

@Controller('test')
export class AppController {
  constructor(private readonly d365foAuthService: D365FOAuthService) {}

  @Get('getAccessToken')
  public async getAccessToken() {
    const token = await this.d365foAuthService.getAccessToken();
    return { token };
  }
}
