import { ConfigSchema } from '@/config';

const tenantIdSchema = ConfigSchema.extract('entra.tenantId');
const clientSecretSchema = ConfigSchema.extract('entra.clientSecret');
const redirectUriSchema = ConfigSchema.extract('entra.redirectUri');

describe('ENTRA_TENANT_ID validation', () => {
  it('accepts a tenant GUID', () => {
    const validation = tenantIdSchema.validate(
      '18628f3c-d584-4e0f-91cd-5a2f04a0d8cb',
    );

    expect(validation.error).toBeUndefined();
  });

  it.each([
    '18628f3c-d584-4e0f-91cd-5a2f04a0d8cb/v2.0',
    'https://login.microsoftonline.com/18628f3c-d584-4e0f-91cd-5a2f04a0d8cb',
    'login.microsoftonline.com',
    'oauth2',
    'v2.0',
  ])('rejects malformed tenant value %s', (tenantId) => {
    const validation = tenantIdSchema.validate(tenantId);

    expect(validation.error).toBeDefined();
  });

  it.each([undefined, '', 'short-secret'])(
    'rejects missing or short client secret %s',
    (clientSecret) => {
      expect(clientSecretSchema.validate(clientSecret).error).toBeDefined();
    },
  );

  it.each([
    'http://localhost:3000/api/v1/auth/microsoft/callback',
    'https://middleware.example.com/api/v1/auth/microsoft/callback',
  ])('accepts backend Microsoft callback URL %s', (redirectUri) => {
    expect(redirectUriSchema.validate(redirectUri).error).toBeUndefined();
  });

  it.each([
    'http://localhost:5173/microsoft-callback',
    'http://localhost:3000/api/auth/microsoft/callback',
    'http://localhost:3000/api/v1/auth/microsoft/callback?source=test',
  ])('rejects invalid Microsoft callback URL %s', (redirectUri) => {
    expect(redirectUriSchema.validate(redirectUri).error).toBeDefined();
  });
});
