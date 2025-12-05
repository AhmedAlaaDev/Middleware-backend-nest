import * as argon from 'argon2';

export class HashingService {
  public hash(raw: string): Promise<string> {
    return argon.hash(raw);
  }

  public verify(raw: string, hash: string): Promise<boolean> {
    return argon.verify(hash, raw);
  }
}
