import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { RefreshToken } from '@/modules/auth/schemas/refresh-token.schema';
import { HashingService } from '@/modules/auth/services/hashing.service';

interface StoreNewOpts {
  jti: string;
  familyId: string;
  userId: string;
  rawToken: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly hashingService: HashingService,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshToken>,
  ) {}

  public async storeNew(opts: StoreNewOpts): Promise<void> {
    const hashedToken = await this.hashingService.hash(opts.rawToken);

    await this.refreshTokenModel.create({
      _id: opts.jti,
      familyId: opts.familyId,
      userId: opts.userId,
      hashedToken,
      expiresAt: opts.expiresAt,
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
  }

  public findByJti(jti: string): Promise<RefreshToken | null> {
    return this.refreshTokenModel.findById(jti).lean().exec();
  }

  public async revokeByJti(jti: string): Promise<void> {
    await this.refreshTokenModel.updateMany(
      { _id: jti, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  public async revokeFamilyForUser(
    userId: string,
    familyId: string,
  ): Promise<void> {
    await this.refreshTokenModel.updateMany(
      { userId, familyId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  public async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenModel.updateMany(
      { userId, revokedAt: null },
      { revokedAt: new Date() },
    );
  }

  public async rotate(
    old: RefreshToken,
    newToken: { jti: string; raw: string; exp: Date },
    ctx: { ip?: string; ua?: string },
  ) {
    const hashedNew = await this.hashingService.hash(newToken.raw);

    await Promise.all([
      this.refreshTokenModel.updateOne(
        { _id: old._id },
        { revokedAt: new Date(), replacedById: newToken.jti },
      ),
      this.refreshTokenModel.create({
        _id: newToken.jti,
        familyId: old.familyId,
        userId: old.userId,
        hashedToken: hashedNew,
        expiresAt: newToken.exp,
        ip: ctx.ip,
        userAgent: ctx.ua,
      }),
    ]);
  }

  /**
   * Clean up expired refresh tokens
   * @returns Number of deleted tokens
   */
  public async cleanupExpiredTokens(): Promise<number> {
    const result = await this.refreshTokenModel.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    return result.deletedCount || 0;
  }

  /**
   * Clean up old revoked tokens (older than specified days)
   * @param daysOld Number of days to keep revoked tokens
   * @returns Number of deleted tokens
   */
  public async cleanupOldRevokedTokens(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.refreshTokenModel.deleteMany({
      revokedAt: { $ne: null, $lt: cutoffDate },
    });

    return result.deletedCount || 0;
  }

  /**
   * Get statistics about refresh tokens
   */
  public async getTokenStatistics(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }> {
    const now = new Date();

    const [total, active, revoked, expired] = await Promise.all([
      this.refreshTokenModel.countDocuments(),
      this.refreshTokenModel.countDocuments({
        revokedAt: null,
        expiresAt: { $gte: now },
      }),
      this.refreshTokenModel.countDocuments({
        revokedAt: { $ne: null },
      }),
      this.refreshTokenModel.countDocuments({
        expiresAt: { $lt: now },
        revokedAt: null,
      }),
    ]);

    return { total, active, revoked, expired };
  }
}
