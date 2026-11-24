import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AccountCustomerInvoiceMappingDocument =
  HydratedDocument<AccountCustomerInvoiceMapping>;

@Schema({
  collection: 'account_customer_invoice_mappings',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class AccountCustomerInvoiceMapping {
  @Prop()
  name: string;

  @Prop()
  customerAccount: string;

  @Prop()
  invoiceAccount: string;

  @Prop()
  serviceType: number;

  /**
   * Company (m-p or mas). Documents without it are legacy m-p mappings;
   * see the repository for how they are matched.
   */
  @Prop()
  company?: string;
}
export const AccountCustomerInvoiceMappingSchema = SchemaFactory.createForClass(
  AccountCustomerInvoiceMapping,
);
AccountCustomerInvoiceMappingSchema.index({ serviceType: 1 });
AccountCustomerInvoiceMappingSchema.index({ company: 1, serviceType: 1 });
