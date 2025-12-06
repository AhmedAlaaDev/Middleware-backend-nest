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

  constructor(items: T[], total: number, pageSize: number, pageNumber: number) {
    this.items = items;
    this.totalCount = total;
    this.pageSize = pageSize;
    this.pageNumber = pageNumber;
    this.totalPages = Math.ceil(total / pageSize);
  }
}
