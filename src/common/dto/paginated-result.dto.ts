import { ApiProperty } from '@nestjs/swagger';

export class PaginatedResultDto<T> {
  @ApiProperty()
  data: T[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  pageNumber: number;

  @ApiProperty()
  totalPages: number;

  constructor(data: T[], total: number, pageSize: number, pageNumber = 0) {
    this.data = data;
    this.total = total;
    this.pageSize = pageSize;
    this.pageNumber = pageNumber;
    this.totalPages = Math.ceil(total / pageSize);
  }
}

