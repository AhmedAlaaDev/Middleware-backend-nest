export class ITaxItemGroupHeading {
  id: string;
  dataAreaId: string;
  taxItemGroup: string;
  name?: string;
}

export interface ICreateTaxItemGroupHeading {
  dataAreaId: string;
  taxItemGroup: string;
  name?: string;
}

export type IUpdateTaxItemGroupHeading = Partial<ICreateTaxItemGroupHeading>;

export interface ITaxItemGroupHeadingListFilter {
  dataAreaId?: string;
  taxItemGroup?: string;
}
