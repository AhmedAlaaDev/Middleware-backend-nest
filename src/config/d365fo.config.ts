import { registerAs } from '@nestjs/config';

export interface D365FOConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  authority: string;
}

export const d365foConfig = registerAs(
  'd365fo',
  (): D365FOConfig => ({
    tenantId: process.env.D365FO_TENANT_ID ?? '',
    clientId: process.env.D365FO_CLIENT_ID ?? '',
    clientSecret: process.env.D365FO_CLIENT_SECRET ?? '',
    resource: process.env.D365FO_RESOURCE ?? '',
    authority: process.env.D365FO_AUTHORITY ?? '',
  }),
);
