import { HttpException, HttpStatus } from '@nestjs/common';

export type InlineCustomerErrorCode =
  | 'CUSTOMER_ACCOUNT_ALREADY_EXISTS'
  | 'TAX_NUMBER_ALREADY_LINKED_TO_CUSTOMER'
  | 'TAX_NUMBER_COUNTRY_REGION_MISMATCH'
  | 'VAT_NUMBER_CREATE_FAILED'
  | 'CUSTOMER_CREATE_FAILED'
  | 'VAT_ROLLBACK_FAILED'
  | 'CUSTOMER_ROLLBACK_FAILED'
  | 'DFO_VALIDATION_FAILED'
  | 'DFO_UNAVAILABLE'
  | 'REMEDIATION_UPDATE_FAILED_AFTER_CUSTOMER_CREATED';

export interface InlineCustomerErrorDetails {
  dataAreaId: string;
  customerAccount?: string;
  taxExemptNumber?: string;
  addressCountryRegionId?: string;
  endpoint?: string;
  action?: string;
  dfoInnerMessage?: string;
  existingCustomerAccount?: string;
  existingCustomerName?: string;
  existingCountryRegionId?: string;
  requestedCountryRegionId?: string;
  rollback?: {
    attempted: boolean;
    succeeded: boolean;
    message?: string;
  };
}

export class InlineCustomerError extends HttpException {
  constructor(
    code: InlineCustomerErrorCode,
    message: string,
    details: InlineCustomerErrorDetails,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ message, errorCode: code, details }, status);
  }
}
