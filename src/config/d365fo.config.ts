import { registerAs } from '@nestjs/config';

export interface D365FOConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  authority: string;
}

/**
 * Resolve the FO base URL.
 * Production prefers `D365FO_RESOURCE_PROD` so local onebox can stay on
 * `D365FO_RESOURCE` without risking a bad deploy target.
 */
function resolveD365foResource(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  const prodResource = (process.env.D365FO_RESOURCE_PROD ?? '').trim();
  const resource = (process.env.D365FO_RESOURCE ?? '').trim();

  if (isProduction && prodResource) {
    return prodResource;
  }

  return resource;
}

export const d365foConfig = registerAs(
  'd365fo',
  (): D365FOConfig => ({
    tenantId: process.env.D365FO_TENANT_ID ?? '',
    clientId: process.env.D365FO_CLIENT_ID ?? '',
    clientSecret: process.env.D365FO_CLIENT_SECRET ?? '',
    resource: resolveD365foResource(),
    authority: process.env.D365FO_AUTHORITY ?? '',
  }),
);
