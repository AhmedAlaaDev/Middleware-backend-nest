import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';

import { CreateUserDto } from '@/modules/auth/dtos/create-user.dto';
import { LoginDto } from '@/modules/auth/dtos/login.dto';
import {
  RefreshData,
  RefreshResult,
} from '@/modules/auth/interfaces/session.interface';
import { UserPayload } from '@/modules/auth/interfaces/user-payload.interface';
import { HashingService } from '@/modules/auth/services/hashing.service';
import { SessionService } from '@/modules/auth/services/session.service';
import { TokenService } from '@/modules/auth/services/token.service';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { UserService } from '@/modules/user/user.service';

interface IRefreshPayload {
  sub: string;
  jti: string;
  familyId: string;
  type: 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly hashingService: HashingService,
  ) {}

  public async register(dto: CreateUserDto): Promise<RefreshData> {
    const passwordHash = await this.hashingService.hash(dto.password);
    const user = await this.userService.createUser({
      ...dto,
      passwordHash,
    });
    return this.issueSession(user, {});
  }

  public async login(
    dto: LoginDto,
    ctx: { ip?: string; ua?: string },
  ): Promise<RefreshData | null> {
    const user = await this.userService.findUserByEmail(dto.email);
    if (!user) return null;

    const ok = await this.hashingService.verify(
      dto.password,
      user.passwordHash,
    );
    if (!ok) return null;

    return this.issueSession(user, ctx);
  }

  public async refresh(
    presentedToken: string,
    ctx: { ip?: string; ua?: string },
  ): Promise<RefreshResult> {
    // 1) Verify & type
    const payload = await this.tokenService
      .verifyRefresh<IRefreshPayload>(presentedToken)
      .catch(() => null);

    if (!payload || payload.type !== 'refresh') {
      return { ok: false, code: 'INVALID_TYPE' };
    }

    // 2) Lookup
    const record = await this.sessionService.findByJti(payload.jti);
    if (!record) {
      await this.sessionService.revokeFamilyForUser(
        payload.sub,
        payload.familyId,
      );
      return { ok: false, code: 'NOT_FOUND_REUSE_DETECTED' };
    }
    if (record.revokedAt || record.expiresAt <= new Date()) {
      return { ok: false, code: 'EXPIRED_OR_REVOKED' };
    }

    // 3) Hash compare
    const ok = await this.hashingService.verify(
      presentedToken,
      record.hashedToken,
    );
    if (!ok) {
      await this.sessionService.revokeFamilyForUser(
        record.userId,
        record.familyId,
      );
      return { ok: false, code: 'HASH_MISMATCH' };
    }

    // 4) Rotate & issue
    const user = await this.userService.findUserById(record.userId);
    if (!user) {
      await this.sessionService.revokeFamilyForUser(
        record.userId,
        record.familyId,
      );
      return { ok: false, code: 'USER_NOT_FOUND' };
    }
    const accessToken = this.tokenService.signAccess(
      this.buildAccessPayload(user),
    );
    const { exp: atExp } = this.tokenService.decode<{ exp: number }>(
      accessToken,
    );

    const newJti = randomUUID();
    const newRefreshToken = this.tokenService.signRefresh(
      this.buildRefreshPayload(record.userId, newJti, record.familyId),
    );
    const { exp: newRtExp } = this.tokenService.decode<{ exp: number }>(
      newRefreshToken,
    );

    await this.sessionService.rotate(
      record,
      { jti: newJti, raw: newRefreshToken, exp: new Date(newRtExp * 1000) },
      { ip: ctx.ip, ua: ctx.ua },
    );

    return {
      ok: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        atExpiresAt: this.tokenService.formatExpDate(atExp),
        rtExpiresAt: this.tokenService.formatExpDate(newRtExp),
        familyId: record.familyId,
      },
    };
  }

  public async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;

    const payload = this.tokenService.decode<IRefreshPayload>(presentedToken);
    if (payload?.jti) {
      await this.sessionService.revokeByJti(payload.jti);
    }
  }

  public async logoutAll(userId: string): Promise<void> {
    await this.sessionService.revokeAllForUser(userId);
  }

  private buildAccessPayload(user: IUser): UserPayload {
    return {
      sub: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatarPath: user.avatarPath,
      role: user.role,
    };
  }

  private buildRefreshPayload(
    userId: string,
    jti: string,
    familyId: string,
  ): IRefreshPayload {
    return { sub: userId, jti, familyId, type: 'refresh' as const };
  }

  private async issueSession(
    user: IUser,
    ctx: { ip?: string; ua?: string },
  ): Promise<RefreshData> {
    // Access token
    const accessToken = this.tokenService.signAccess(
      this.buildAccessPayload(user),
    );
    const { exp: atExp } = this.tokenService.decode<{ exp: number }>(
      accessToken,
    );
    const accessExpiresAt = this.tokenService.formatExpDate(atExp);

    // Refresh token
    const jti = randomUUID();
    const familyId = randomUUID();
    const refreshToken = this.tokenService.signRefresh(
      this.buildRefreshPayload(user.id, jti, familyId),
    );
    const { exp: rtExp } = this.tokenService.decode<{ exp: number }>(
      refreshToken,
    );
    const refreshExpiresAt = new Date(rtExp * 1000);

    await this.sessionService.storeNew({
      jti,
      familyId,
      userId: user.id,
      rawToken: refreshToken,
      expiresAt: refreshExpiresAt,
      ip: ctx.ip,
      userAgent: ctx.ua,
    });

    return {
      accessToken,
      refreshToken,
      atExpiresAt: accessExpiresAt,
      rtExpiresAt: refreshExpiresAt.toISOString(),
      familyId,
    };
  }
}
