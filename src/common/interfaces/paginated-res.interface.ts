export class IPaginatedRes<T> {
  data: T[];
  total: number;
  pageSize: number;
  pageNumber: number;
  totalPages: number;

  constructor(data: T[], total: number, pageSize: number, pageNumber: number) {
    this.data = data;
    this.total = total;
    this.pageSize = pageSize;
    this.pageNumber = pageNumber;
    this.totalPages = Math.ceil(total / pageSize);
  }
}
