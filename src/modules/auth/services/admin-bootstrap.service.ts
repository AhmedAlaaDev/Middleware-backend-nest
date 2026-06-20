import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EntraConfig, IConfig } from '@/config';
import { HashingService } from '@/modules/auth/services/hashing.service';
import { OperationalLoggerService } from '@/modules/observability/services/operational-logger.service';
import { IdentityProvider } from '@/modules/user/schemas/user.schema';
import { UserService } from '@/modules/user/user.service';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly users: UserService,
    private readonly hashing: HashingService,
    private readonly config: ConfigService<IConfig>,
    private readonly logs: OperationalLoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = this.config.getOrThrow<EntraConfig>('entra');
    const missing = [
      ['ENTRA_TENANT_ID', config.tenantId],
      ['ENTRA_CLIENT_ID', config.clientId],
      ['ENTRA_CLIENT_SECRET', config.clientSecret],
      ['ENTRA_REDIRECT_URI', config.redirectUri],
      ['FRONTEND_AUTH_CALLBACK_URL', config.frontendAuthCallbackUrl],
      ['ADMIN_EMAIL', config.adminEmail],
      ['ADMIN_INITIAL_PASSWORD', config.adminInitialPassword],
    ].filter(([, value]) => !value);
    if (missing.length || config.allowedEmailDomains.length === 0) {
      throw new Error(
        `Missing authentication configuration: ${[
          ...missing.map(([name]) => name),
          ...(config.allowedEmailDomains.length
            ? []
            : ['ENTRA_ALLOWED_EMAIL_DOMAINS']),
        ].join(', ')}`,
      );
    }
    new URL(config.redirectUri);
    new URL(config.frontendAuthCallbackUrl);
    if (config.clientSecretExpiresAt) {
      const daysRemaining = Math.floor(
        (new Date(config.clientSecretExpiresAt).getTime() - Date.now()) /
          (24 * 60 * 60 * 1000),
      );
      if (daysRemaining <= 30) {
        await this.logs.emit({
          level: 'warn',
          message: 'Microsoft Entra client secret expires soon',
          context: AdminBootstrapService.name,
          eventType: 'auth.entra.secret-expiry',
          status: 'warning',
          metadata: { daysRemaining },
        });
      }
    }

    const count = await this.users.countAdmins();
    if (count > 1) {
      throw new Error('Multiple platform administrators exist');
    }
    if (count === 1) {
      const admin = await this.users.findAdmin();
      if (admin?.identityProvider !== IdentityProvider.LOCAL) {
        throw new Error(
          'Legacy administrator migration is required before startup',
        );
      }
      return;
    }

    await this.users.createLocalAdmin({
      email: config.adminEmail,
      passwordHash: await this.hashing.hash(config.adminInitialPassword),
    });
    await this.logs.emit({
      level: 'warn',
      message: 'Platform administrator bootstrapped; password change required',
      context: AdminBootstrapService.name,
      eventType: 'auth.admin.bootstrapped',
      status: 'created',
    });
    this.logger.warn(
      'Platform administrator created; password change required',
    );
  }
}
