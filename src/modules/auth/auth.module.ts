import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthController } from '@/modules/auth/auth.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { ApiKeyGuard } from '@/modules/auth/guards/api-key.guard';
import { AuthGuard } from '@/modules/auth/guards/auth.guard';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import {
  RefreshToken,
  RefreshTokenSchema,
} from '@/modules/auth/schemas/refresh-token.schema';
import { HashingService } from '@/modules/auth/services/hashing.service';
import { SessionService } from '@/modules/auth/services/session.service';
import { TokenService } from '@/modules/auth/services/token.service';
import { EntraOidcService } from '@/modules/auth/services/entra-oidc.service';
import { LoginRateLimitService } from '@/modules/auth/services/login-rate-limit.service';
import { AdminBootstrapService } from '@/modules/auth/services/admin-bootstrap.service';
import { AdminAccessController } from '@/modules/user/admin-access.controller';
import { AccessReviewService } from '@/modules/user/access-review.service';
import {
  AccessDecision,
  AccessDecisionSchema,
} from '@/modules/user/schemas/access-decision.schema';
import { UserController } from '@/modules/user/user.controller';
import { UserModule } from '@/modules/user/user.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
    }),
    MongooseModule.forFeature([
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: AccessDecision.name, schema: AccessDecisionSchema },
    ]),
    UserModule,
  ],
  providers: [
    TokenService,
    HashingService,
    SessionService,
    AuthService,
    EntraOidcService,
    LoginRateLimitService,
    AdminBootstrapService,
    AccessReviewService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  controllers: [AuthController, UserController, AdminAccessController],
  exports: [SessionService],
})
export class AuthModule {}
