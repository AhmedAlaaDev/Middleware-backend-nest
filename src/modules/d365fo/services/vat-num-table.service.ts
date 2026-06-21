import { Injectable } from '@nestjs/common';

import { D365FOClientService } from './d365fo-client.service';
import { ODataQueryBuilderService } from './odata-query-builder.service';

import type {
  CreateVatNumTableInput,
  VatNumTableRecord,
} from '@/modules/d365fo/types';

@Injectable()
export class VatNumTableService {
  constructor(
    private readonly d365foClient: D365FOClientService,
    private readonly queryBuilder: ODataQueryBuilderService,
  ) {}

  public async findVatNums(
    dataAreaId: string,
    vatNum: string,
  ): Promise<VatNumTableRecord[]> {
    const filter = this.queryBuilder.and(
      this.queryBuilder.eq('dataAreaId', dataAreaId),
      this.queryBuilder.eq('VATNum', vatNum),
    );
    const endpoint = this.queryBuilder.buildQuery('/data/VATNumTables', {
      filter,
      crossCompany: true,
      top: 50,
    });
    const response = await this.d365foClient.get<VatNumTableRecord>(endpoint, {
      useCache: false,
    });
    return response.value;
  }

  public async findVatNum(
    dataAreaId: string,
    vatNum: string,
  ): Promise<VatNumTableRecord | null> {
    return (await this.findVatNums(dataAreaId, vatNum))[0] ?? null;
  }

  public createVatNum(
    input: CreateVatNumTableInput,
  ): Promise<VatNumTableRecord> {
    return this.d365foClient.post<CreateVatNumTableInput, VatNumTableRecord>(
      '/data/VATNumTables',
      input,
    );
  }

  public async deleteVatNum(
    dataAreaId: string,
    vatNum: string,
    countryRegionId: string,
  ): Promise<void> {
    const escape = (part: string) => this.queryBuilder.escapeString(part);
    const endpoint =
      `/data/VATNumTables(dataAreaId='${escape(dataAreaId)}',` +
      `VATNum='${escape(vatNum)}',CountryRegionId='${escape(countryRegionId)}')` +
      '?cross-company=true';
    await this.d365foClient.delete(endpoint);
  }
}
