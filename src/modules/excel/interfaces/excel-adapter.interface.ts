export abstract class IExcelAdapter {
  abstract read<T = any>(buffer: Buffer): Promise<T[]>;
  abstract write<T extends object = { [key: string]: any }>(
    data: T[],
  ): Promise<Buffer>;
}
