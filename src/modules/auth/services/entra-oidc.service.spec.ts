import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { jwtVerify } from 'jose';

import { EntraConfig, IConfig } from '@/config';
import { EntraOidcService } from '@/modules/auth/services/entra-oidc.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    isAxiosError: jest.fn(),
  },
}));
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

const tenantId = '18628f3c-d584-4e0f-91cd-5a2f04a0d8cb';
const config: EntraConfig = {
  tenantId,
  clientId: 'client-id',
  clientSecret: 'client-secret-value-long-enough',
  redirectUri: 'http://localhost:3000/api/v1/auth/microsoft/callback',
  allowedEmailDomains: ['example.com'],
  frontendAuthCallbackUrl: 'http://localhost:5173/microsoft-callback',
  adminEmail: 'admin@example.com',
  adminInitialPassword: 'temporary-password',
};
const axiosPost = jest.spyOn(axios, 'post');
const isAxiosError = jest.spyOn(axios, 'isAxiosError');

function createService() {
  const redisClient = {
    set: jest.fn().mockResolvedValue('OK'),
    getdel: jest.fn(),
  };
  const logs = { emit: jest.fn().mockResolvedValue(undefined) };
  const users = { upsertEntraUser: jest.fn() };
  const configService = {
    getOrThrow: () => config,
  } as unknown as ConfigService<IConfig>;
  const service = new EntraOidcService(
    configService,
    { getClient: () => redisClient } as never,
    users as never,
    logs as never,
  );
  return { service, redisClient, logs, users };
}

describe(EntraOidcService.name, () => {
  it('uses the tenant authority for the Microsoft authorization endpoint', async () => {
    const { service } = createService();

    const { authorizationUrl } = await service.start('/dashboard');
    const url = new URL(authorizationUrl);

    expect(url.origin + url.pathname).toBe(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    );
    expect(authorizationUrl).not.toContain('/v2.0/oauth2/v2.0/authorize');
  });

  it('posts the authorization code and PKCE verifier to the tenant token endpoint', async () => {
    const { service, redisClient, users } = createService();
    redisClient.getdel.mockResolvedValue(
      JSON.stringify({
        nonce: 'expected-nonce',
        codeVerifier: 'pkce-verifier',
        returnPath: '/dashboard',
      }),
    );
    axiosPost.mockResolvedValue({
      data: { id_token: 'id-token' },
    });
    jest.mocked(jwtVerify).mockResolvedValue({
      payload: {
        tid: tenantId,
        oid: 'object-id',
        acct: 0,
        nonce: 'expected-nonce',
        email: 'user@example.com',
      },
      protectedHeader: { alg: 'RS256' },
    });
    users.upsertEntraUser.mockResolvedValue({
      id: 'user-id',
      accessStatus: 'PENDING',
    });

    await service.callback({
      code: 'authorization-code',
      state: 'state',
      cookieState: 'state',
    });

    const [tokenEndpoint, requestBody] = axiosPost.mock.calls[0];
    expect(tokenEndpoint).toBe(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    );
    expect(Object.fromEntries(requestBody as URLSearchParams)).toMatchObject({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: config.redirectUri,
      code_verifier: 'pkce-verifier',
    });
  });

  it('logs the Microsoft response before rejecting a failed token exchange', async () => {
    const { service, redisClient, logs } = createService();
    redisClient.getdel.mockResolvedValue(
      JSON.stringify({
        nonce: 'expected-nonce',
        codeVerifier: 'pkce-verifier',
        returnPath: '/dashboard',
      }),
    );
    const microsoftError = Object.assign(new Error('Request failed with 401'), {
      name: 'AxiosError',
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 401,
        data: {
          error: 'invalid_client',
          error_description: 'AADSTS7000215: Invalid client secret provided.',
        },
      },
    });
    axiosPost.mockRejectedValue(microsoftError);
    isAxiosError.mockReturnValue(true);

    await expect(
      service.callback({
        code: 'authorization-code',
        state: 'state',
        cookieState: 'state',
      }),
    ).rejects.toThrow('Microsoft authentication failed');
    expect(logs.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Microsoft token exchange failed',
        eventType: 'auth.microsoft.token-exchange.failed',
        status: '401',
        error: expect.objectContaining({
          name: 'AxiosError',
          message: 'Request failed with 401',
        }),
        metadata: expect.objectContaining({
          errorCode: 'ERR_BAD_REQUEST',
          responseStatus: 401,
          responseData: expect.stringContaining('AADSTS7000215'),
        }),
      }),
    );
  });
});
