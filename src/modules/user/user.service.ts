import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { IUser } from '@/modules/user/interfaces/user.interface';
import {
  AccessStatus,
  IdentityProvider,
  User,
  UserRole,
} from '@/modules/user/schemas/user.schema';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  public async createLocalAdmin(input: {
    firstName?: string;
    lastName?: string;
    email: string;
    passwordHash: string;
  }): Promise<IUser> {
    const newUser = await this.userModel.create({
      ...input,
      email: this.normalizeEmail(input.email),
      identityProvider: IdentityProvider.LOCAL,
      role: UserRole.ADMIN,
      mustChangePassword: true,
      sessionVersion: 1,
    });
    return this.toInterface(newUser);
  }

  public async findUserByEmail(email: string): Promise<IUser | null> {
    const user = await this.userModel
      .findOne({ email: this.normalizeEmail(email) })
      .lean()
      .exec();

    return user ? this.toInterface(user) : null;
  }

  public async findUserById(id: string): Promise<IUser | null> {
    const user = await this.userModel.findById(id).lean().exec();
    return user ? this.toInterface(user) : null;
  }

  public async findEntraUser(
    tenantId: string,
    objectId: string,
  ): Promise<IUser | null> {
    const user = await this.userModel
      .findOne({ entraTenantId: tenantId, entraObjectId: objectId })
      .lean()
      .exec();
    return user ? this.toInterface(user) : null;
  }

  public async upsertEntraUser(input: {
    tenantId: string;
    objectId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<IUser> {
    const now = new Date();
    const user = await this.userModel
      .findOneAndUpdate(
        {
          entraTenantId: input.tenantId,
          entraObjectId: input.objectId,
        },
        {
          $set: {
            email: this.normalizeEmail(input.email),
            firstName: input.firstName ?? '',
            lastName: input.lastName ?? '',
            lastSignInAt: now,
            lastIp: input.ip,
            lastUserAgent: input.userAgent,
          },
          $setOnInsert: {
            identityProvider: IdentityProvider.ENTRA,
            accessStatus: AccessStatus.PENDING,
            sessionVersion: 1,
            firstSignInAt: now,
          },
        },
        { new: true, upsert: true, runValidators: true },
      )
      .lean()
      .exec();
    return this.toInterface(user);
  }

  public countAdmins(): Promise<number> {
    return this.userModel.countDocuments({ role: UserRole.ADMIN }).exec();
  }

  public async findAdmin(): Promise<IUser | null> {
    const user = await this.userModel
      .findOne({ role: UserRole.ADMIN })
      .lean()
      .exec();
    return user ? this.toInterface(user) : null;
  }

  public async updateAdminProfile(
    id: string,
    input: { firstName?: string; lastName?: string; avatarPath?: string },
  ): Promise<IUser> {
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: id, role: UserRole.ADMIN },
        { $set: input },
        { new: true, runValidators: true },
      )
      .lean()
      .orFail()
      .exec();
    return this.toInterface(user);
  }

  public async changeAdminPassword(
    id: string,
    passwordHash: string,
  ): Promise<IUser> {
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: id, role: UserRole.ADMIN },
        {
          $set: { passwordHash, mustChangePassword: false },
          $inc: { sessionVersion: 1 },
        },
        { new: true },
      )
      .lean()
      .orFail()
      .exec();
    return this.toInterface(user);
  }

  public async listWorkforce(input: {
    status?: AccessStatus;
    search?: string;
    limit: number;
    cursor?: string;
  }): Promise<IUser[]> {
    const filter: Record<string, unknown> = {
      identityProvider: IdentityProvider.ENTRA,
    };
    if (input.status) filter.accessStatus = input.status;
    if (input.cursor) filter._id = { $lt: input.cursor };
    if (input.search) {
      const escaped = input.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: escaped, $options: 'i' } },
        { firstName: { $regex: escaped, $options: 'i' } },
        { lastName: { $regex: escaped, $options: 'i' } },
      ];
    }
    const users = await this.userModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(input.limit)
      .lean()
      .exec();
    return users.map((user) => this.toInterface(user));
  }

  public async transitionAccess(
    id: string,
    from: AccessStatus[],
    to: AccessStatus,
  ): Promise<IUser | null> {
    const update: Record<string, unknown> = {
      $set: {
        accessStatus: to,
        role: to === AccessStatus.APPROVED ? UserRole.OPS : undefined,
      },
      $inc: { sessionVersion: 1 },
    };
    if (to !== AccessStatus.APPROVED) {
      update.$unset = { role: 1 };
      delete (update.$set as Record<string, unknown>).role;
    }
    const user = await this.userModel
      .findOneAndUpdate(
        {
          _id: id,
          identityProvider: IdentityProvider.ENTRA,
          accessStatus: { $in: from },
        },
        update,
        { new: true },
      )
      .lean()
      .exec();
    return user ? this.toInterface(user) : null;
  }

  private toInterface(user: any): IUser {
    return {
      id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      avatarPath: user.avatarPath,
      passwordHash: user.passwordHash,
      identityProvider: user.identityProvider,
      accessStatus: user.accessStatus,
      entraTenantId: user.entraTenantId,
      entraObjectId: user.entraObjectId,
      mustChangePassword: user.mustChangePassword ?? false,
      sessionVersion: user.sessionVersion ?? 1,
      firstSignInAt: user.firstSignInAt,
      lastSignInAt: user.lastSignInAt,
      lastIp: user.lastIp,
      lastUserAgent: user.lastUserAgent,
      refreshTokens: user.refreshTokens || [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
