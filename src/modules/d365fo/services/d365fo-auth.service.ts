import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { MultiLayerCacheService } from '../../cache/services/multi-layer-cache.service';
import { AxiosRequestConfig } from 'axios';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: Date;
}

@Injectable()
export class D365FOAuthService {
  private readonly logger = new Logger(D365FOAuthService.name);
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly authority: string;
  private readonly resource: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cache: MultiLayerCacheService,
  ) {
    this.tenantId = this.configService.get<string>('D365FO_TENANT_ID') || '';
    this.clientId = this.configService.get<string>('D365FO_CLIENT_ID') || '';
    this.clientSecret =
      this.configService.get<string>('D365FO_CLIENT_SECRET') || '';
    this.authority =
      this.configService.get<string>(
        'D365FO_AUTHORITY',
        'https://login.microsoftonline.com',
      ) || '';
    this.resource = this.configService.get<string>('D365FO_RESOURCE') || '';
  }

  /**
   * Get access token with caching
   */
  async getAccessToken(): Promise<string> {
    const cacheKey = 'd365fo:access-token';

    // Request token first to get expiry time
    const token = await this.requestAccessToken();
    const ttl = (token.expires_in - 300) * 1000; // Cache until 5 min before expiry

    return this.cache.get(
      cacheKey,
      async () => {
        return token.access_token;
      },
      {
        l1Ttl: ttl,
        l2Ttl: ttl,
        skipL3: true, // Don't cache tokens in L3 (database)
      },
    );
  }

  /**
   * Request access token from Azure AD
   */
  private async requestAccessToken(): Promise<TokenResponse> {
    const tokenUrl = `${this.authority}/${this.tenantId}/oauth2/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('resource', this.resource);

    try {
      const response = await firstValueFrom(
        this.httpService.post<TokenResponse>(tokenUrl, params, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );

      const tokenResponse: TokenResponse = {
        ...response.data,
        expires_at: new Date(
          Date.now() + response.data.expires_in * 1000,
        ),
      };

      this.logger.debug('Successfully obtained D365FO access token');
      return tokenResponse;
    } catch (error: any) {
      this.logger.error(
        `Failed to obtain D365FO access token: ${error.message}`,
      );
      throw new Error('Failed to authenticate with D365FO');
    }
  }

  /**
   * Get authorization header value
   */
  async getAuthorizationHeader(): Promise<string> {
    const token = await this.getAccessToken();
    return `Bearer ${token}`;
  }
}

