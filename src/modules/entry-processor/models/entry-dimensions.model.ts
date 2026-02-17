export class EntryDimensionsModel {
  mainAccount?: string;
  costCenter?: string;
  activityName?: string;
  businessUnit?: string;
  location?: string;
  customer?: string;
  subCustomer?: string;
  vendor?: string;
  subVendor?: string;
  chargeType?: string;
  salesMan?: string;
  coordinatorMan?: string;
  freightType: string = 'Payable';
  truckerType?: string;
  truckNumber?: string;
  direction?: string;
  worker?: string;
  fixedAsset?: string;
  lease?: string;
}
