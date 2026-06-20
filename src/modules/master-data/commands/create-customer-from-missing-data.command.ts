import { Command } from '@nestjs/cqrs';

import { CreateCustomerDto } from '@/modules/master-data/dtos/create-customer.dto';
import { ICreateCustomerFromMissingDataResult } from '@/modules/master-data/interfaces/customer.interface';

export class CreateCustomerFromMissingDataCommand extends Command<ICreateCustomerFromMissingDataResult> {
  constructor(
    public readonly missingDataId: string,
    public readonly dto: CreateCustomerDto,
  ) {
    super();
  }
}
