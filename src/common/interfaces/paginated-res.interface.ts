import { ApiProperty } from '@nestjs/swagger';

export class IPaginatedRes<T> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty()
  totalCount: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  pageNumber: number;

  @ApiProperty()
  totalPages: number;

  constructor(
    items: T[],
    totalCount: number,
    maxCount?: number, // page size
    skipCount?: number, // offset
  ) {
    this.items = items;
    this.totalCount = totalCount;

    // pageSize = maxCount أو totalCount لو undefined
    this.pageSize = maxCount ?? totalCount;

    // pageNumber = (skipCount / pageSize) + 1
    this.pageNumber =
      maxCount && skipCount !== undefined
        ? Math.floor(skipCount / this.pageSize) + 1
        : 1;

    // totalPages = totalCount / pageSize
    this.totalPages =
      this.pageSize > 0 ? Math.ceil(totalCount / this.pageSize) : 1;
  }
}
