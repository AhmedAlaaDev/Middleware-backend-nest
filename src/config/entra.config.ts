import { registerAs } from '@nestjs/config';

export interface EntraConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt?: string;
  redirectUri: string;
  allowedEmailDomains: string[];
  frontendAuthCallbackUrl: string;
  adminEmail: string;
  adminInitialPassword: string;
}

export const entraConfig = registerAs(
  'entra',
  (): EntraConfig => ({
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
    clientId: process.env.ENTRA_CLIENT_ID ?? '',
    clientSecret: process.env.ENTRA_CLIENT_SECRET ?? '',
    clientSecretExpiresAt: process.env.ENTRA_CLIENT_SECRET_EXPIRES_AT,
    redirectUri: process.env.ENTRA_REDIRECT_URI ?? '',
    allowedEmailDomains: (process.env.ENTRA_ALLOWED_EMAIL_DOMAINS ?? '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    frontendAuthCallbackUrl: process.env.FRONTEND_AUTH_CALLBACK_URL ?? '',
    adminEmail: process.env.ADMIN_EMAIL ?? '',
    adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD ?? '',
  }),
);
