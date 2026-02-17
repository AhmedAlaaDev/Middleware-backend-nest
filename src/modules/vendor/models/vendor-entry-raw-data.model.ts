import { EntryRawDataModel } from '@/modules/entry-processor/models';

export class VendorEntryRawDataModel extends EntryRawDataModel {
  constructor(data: Partial<VendorEntryRawDataModel>) {
    super(data);
  }
}
