import { IsEnum, IsOptional } from 'class-validator';

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
}
