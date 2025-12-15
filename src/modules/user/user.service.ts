import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ICreateUser } from '@/modules/user/interfaces/create-user.interface';
import { IUser } from '@/modules/user/interfaces/user.interface';
import { User } from '@/modules/user/schemas/user.schema';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  public async createUser(user: ICreateUser): Promise<IUser> {
    const newUser = await this.userModel.create(user);
    return this.toInterface(newUser);
  }

  public async findUserByEmail(email: string): Promise<IUser | null> {
    const user = await this.userModel.findOne({ email }).lean().exec();
    return user ? this.toInterface(user) : null;
  }

  public async findUserById(id: string): Promise<IUser | null> {
    const user = await this.userModel.findById(id).lean().exec();
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
      refreshTokens: user.refreshTokens || [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
