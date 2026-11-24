import { Injectable } from '@nestjs/common';

import {
  loadMasRevenueConfig,
  type MasRevenueVerifiedConfig,
} from './mas-revenue-config';

/**
 * Reads the verified MAS configuration when it is needed. It is read at call
 * time, not at startup, so a corrected file takes effect without a restart and
 * a missing file closes the gates instead of breaking the server.
 */
@Injectable()
export class MasRevenueConfigProvider {
  public current(): {
    config: MasRevenueVerifiedConfig;
    source: string | null;
  } {
    return loadMasRevenueConfig();
  }
}
