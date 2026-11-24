import { IsEnum, IsIn, IsOptional } from 'class-validator';

import { SUPPORTED_COMPANY_CODES } from '@/common/company/company-code';
import { PaginatedDto } from '@/common/dtos/paginated.dto';
import { ServiceTypes } from '@/modules/master-data/enums';

export class GetAccountMappingsDto extends PaginatedDto {
  /**
   * Service type
   * 1=Freight, 2=Trucking, 3=FreightCreditNote, 4=TruckingCreditNote
   */
  @IsOptional()
  @IsEnum(ServiceTypes)
  serviceType?: ServiceTypes;

  /** Only mappings owned by this company. For m-p, legacy mappings also match. */
  @IsOptional()
  @IsIn(SUPPORTED_COMPANY_CODES)
  company?: string;
}
