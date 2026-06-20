import { DynDataModel } from '@/modules/entry-processor/models/dyn-data-model';
import { EntryDimensionsModel } from '@/modules/entry-processor/models/entry-dimensions.model';
import { DimensionValidationService } from '@/modules/master-data/services/dimension-validation.service';

class TestDynDataModel extends DynDataModel {
  AccountType = 'Cust';
}

describe(DimensionValidationService.name, () => {
  it('registers one canonical missing customer across Customer and SubCustomer', () => {
    const service = new DimensionValidationService();
    const record = new TestDynDataModel();
    record.DimensionModel = {
      customer: 'C-404',
      subCustomer: 'C-404',
    } as EntryDimensionsModel;

    service.validateDimensions(
      record,
      {
        requiredDimensions: {
          Customer: true,
          SubCustomer: true,
        },
      },
      {
        dimensionsMap: new Map([
          ['Customer', new Set()],
          ['SubCustomer', new Set()],
        ]),
        accountNumberSet: new Set(),
      },
    );

    expect(record.GetMissingMasterData()).toEqual([
      {
        type: 'customer',
        missingField: 'CustomerAccount',
        missingValue: 'C-404',
        formDefaults: { CustomerAccount: 'C-404' },
      },
    ]);
  });
});
