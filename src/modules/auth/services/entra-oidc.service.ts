import { createHash, randomBytes, randomUUID } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';

import { EntraConfig, IConfig } from '@/config';
import { LogStreamService } from '@/modules/observability/services/log-stream.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { UserService } from '@/modules/user/user.service';

interface OidcTransaction {
  nonce: string;
  codeVerifier: string;
  returnPath: string;
}

interface ExchangeRecord {
  userId: string;
  returnPath: string;
}

@Injectable()
export class EntraOidcService {
  private readonly config: EntraConfig;
  private readonly authority: string;
  private readonly issuer: string;
  private readonly jwks;

  constructor(
    configService: ConfigService<IConfig>,
    private readonly redis: LogStreamService,
    private readonly users: UserService,
    private readonly logs: OperationalLoggerService,
  ) {
    this.config = configService.getOrThrow<EntraConfig>('entra');
    this.authority = `https://login.microsoftonline.com/${this.config.tenantId}`;
    this.issuer = `${this.authority}/v2.0`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.authority}/discovery/v2.0/keys`),
    );
  }

  async start(returnPath?: string) {
    const state = this.randomToken();
    const nonce = this.randomToken();
    const codeVerifier = this.randomToken(64);
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const transaction: OidcTransaction = {
      nonce,
      codeVerifier,
      returnPath: this.safeReturnPath(returnPath),
    };
    await this.redis
      .getClient()
      .set(`auth:oidc:${state}`, JSON.stringify(transaction), 'EX', 600);

    const url = new URL(`${this.authority}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return { state, authorizationUrl: url.toString() };
  }

  async callback(input: {
    code?: string;
    state?: string;
    cookieState?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ exchangeCode: string; returnPath: string }> {
    if (!input.code || !input.state || input.cookieState !== input.state) {
      throw new BadRequestException('Invalid Microsoft login transaction');
    }

    const redis = this.redis.getClient();
    const transactionRaw = await redis.getdel(`auth:oidc:${input.state}`);
    if (!transactionRaw) {
      throw new BadRequestException('Microsoft login transaction expired');
    }
    const transaction = JSON.parse(transactionRaw) as OidcTransaction;
    const idToken = await this.exchangeAuthorizationCode(
      input.code,
      transaction.codeVerifier,
    );
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: this.issuer,
      audience: this.config.clientId,
    });
    const user = await this.resolveUser(payload, transaction.nonce, input);
    const exchangeCode = randomUUID();
    const exchange: ExchangeRecord = {
      userId: user.id,
      returnPath: transaction.returnPath,
    };
    await redis.set(
      `auth:exchange:${exchangeCode}`,
      JSON.stringify(exchange),
      'EX',
      60,
    );
    await this.logs.emit({
      level: 'info',
      message: 'Microsoft workforce sign in completed',
      context: EntraOidcService.name,
      eventType: 'auth.microsoft.completed',
      status: user.accessStatus,
      userId: user.id,
    });
    return { exchangeCode, returnPath: transaction.returnPath };
  }

  async consumeExchange(code: string): Promise<ExchangeRecord> {
    const value = await this.redis.getClient().getdel(`auth:exchange:${code}`);
    if (!value) throw new BadRequestException('Login code expired or used');
    return JSON.parse(value) as ExchangeRecord;
  }

  private async resolveUser(
    payload: JWTPayload,
    expectedNonce: string,
    ctx: { ip?: string; userAgent?: string },
  ): Promise<IUser> {
    if (payload.nonce !== expectedNonce) {
      throw new UnauthorizedException('Invalid Microsoft login nonce');
    }
    if (
      payload.tid !== this.config.tenantId ||
      typeof payload.oid !== 'string'
    ) {
      throw new ForbiddenException('Account is outside the company tenant');
    }
    if (payload.acct !== 0 || payload.idtyp === 'app') {
      throw new ForbiddenException('Verified tenant membership is required');
    }

    const emailValue =
      typeof payload.email === 'string'
        ? payload.email
        : typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : '';
    const email = emailValue.trim().toLowerCase();
    const domain = email.split('@')[1];
    if (!domain || !this.config.allowedEmailDomains.includes(domain)) {
      throw new ForbiddenException('Company email address is required');
    }
    if (email === this.config.adminEmail.trim().toLowerCase()) {
      throw new ForbiddenException('Administrator must use local sign in');
    }

    const nameParts =
      typeof payload.name === 'string' ? payload.name.trim().split(/\s+/) : [];
    return this.users.upsertEntraUser({
      tenantId: payload.tid,
      objectId: payload.oid,
      email,
      firstName:
        typeof payload.given_name === 'string'
          ? payload.given_name
          : nameParts[0],
      lastName:
        typeof payload.family_name === 'string'
          ? payload.family_name
          : nameParts.slice(1).join(' '),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  private safeReturnPath(value?: string): string {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
    return value;
  }

  private randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  private async exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
  ): Promise<string> {
    const tokenEndpoint = `${this.authority}/oauth2/v2.0/token`;
    try {
      const response = await axios.post<{ id_token?: string }>(
        tokenEndpoint,
        new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
          code_verifier: codeVerifier,
          scope: 'openid profile email',
        }),
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          timeout: 15_000,
        },
      );
      if (response.data.id_token) return response.data.id_token;
    } catch (error) {
      await this.logTokenExchangeFailure(error, tokenEndpoint);
    }
    throw new UnauthorizedException('Microsoft authentication failed');
  }

  private async logTokenExchangeFailure(
    error: unknown,
    tokenEndpoint: string,
  ): Promise<void> {
    const axiosError = axios.isAxiosError(error) ? error : undefined;
    const caughtError =
      error instanceof Error ? error : new Error(String(error));
    await this.logs.emit({
      level: 'error',
      message: 'Microsoft token exchange failed',
      context: EntraOidcService.name,
      eventType: 'auth.microsoft.token-exchange.failed',
      status: String(axiosError?.response?.status ?? 'unknown'),
      error: {
        name: caughtError.name,
        message: caughtError.message,
        stack: caughtError.stack,
      },
      metadata: {
        errorCode: axiosError?.code ?? null,
        responseStatus: axiosError?.response?.status ?? null,
        responseData: this.serializeResponseData(axiosError?.response?.data),
        tokenEndpoint,
      },
    });
  }

  private serializeResponseData(responseData: unknown): string | null {
    if (responseData === undefined) return null;
    if (typeof responseData === 'string') return responseData;
    return JSON.stringify(responseData);
  }
}
