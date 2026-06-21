import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

import { D365FOConfig, IConfig } from '@/config';
import { DfoErrorExtractorService } from '@/modules/d365fo/services/dfo-error-extractor.service';
import { CacheService } from '@/modules/resilience/services/cache.service';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: Date;
}

@Injectable()
export class D365FOAuthService {
  private readonly logger = new Logger(D365FOAuthService.name);
  private readonly _cacheKey = 'd365fo:access-token';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<IConfig>,
    private readonly cacheService: CacheService,
    private readonly dfoErrors: DfoErrorExtractorService,
  ) {}

  public async getAccessToken(): Promise<string> {
    let token = await this.cacheService.get<TokenResponse>(this._cacheKey);

    if (token) {
      return token.access_token;
    }

    token = await this.requestAccessToken();

    const ttl = (token.expires_in - 300) * 1000;

    await this.cacheService.set(this._cacheKey, token, ttl);

    return token.access_token;
  }

  public async getAuthorizationHeader(): Promise<string> {
    const token = await this.getAccessToken();
    return `Bearer ${token}`;
  }

  private async requestAccessToken(): Promise<TokenResponse> {
    const { authority, tenantId, clientId, clientSecret, resource } =
      this.d365foConfig;

    // Validate required configuration
    const missing: string[] = [];
    if (!authority) missing.push('D365FO_AUTHORITY');
    if (!tenantId) missing.push('D365FO_TENANT_ID');
    if (!clientId) missing.push('D365FO_CLIENT_ID');
    if (!clientSecret) missing.push('D365FO_CLIENT_SECRET');
    if (!resource) missing.push('D365FO_RESOURCE');

    if (missing.length > 0) {
      const errorMsg = `Missing required D365FO configuration: ${missing.join(', ')}`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const tokenUrl = `${authority}/${tenantId}/oauth2/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('resource', resource);

    try {
      const response = await firstValueFrom(
        this.httpService.post<TokenResponse>(tokenUrl, params, {
          family: 4,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      const tokenResponse: TokenResponse = {
        ...response.data,
        expires_at: new Date(Date.now() + response.data.expires_in * 1000),
      };

      this.logger.debug('Successfully obtained D365FO access token');
      return tokenResponse;
    } catch (error) {
      const dfoError = this.dfoErrors.toError(error, {
        method: 'POST',
        endpoint: tokenUrl,
      });

      this.logger.error(
        `Failed to obtain D365FO access token (Status: ${dfoError.status ?? 'N/A'}): ${dfoError.message}`,
      );
      throw dfoError;
    }
  }

  private get d365foConfig(): D365FOConfig {
    return this.configService.get<D365FOConfig>('d365fo')!;
  }
}
