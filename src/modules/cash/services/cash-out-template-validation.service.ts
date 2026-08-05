import { BadRequestException, Injectable } from '@nestjs/common';

export const CASH_OUT_TEMPLATE_HEADERS = [
  'UniqueId',
  'LINENUMBER',
  'JOURNALBATCHNUMBER',
  'JOURNALNAME',
  'DESCRIPTION',
  'VOUCHER',
  'TRANSDATE',
  'ACCOUNTTYPE',
  'ACCOUNTDISPLAYVALUE',
  'DEFAULTDIMENSIONDISPLAYVALUE',
  'FINTAGDISPLAYVALUE',
  'TEXT',
  'DEBITAMOUNT',
  'CREDITAMOUNT',
  'CURRENCYCODE',
  'EXCHANGERATE',
  'OFFSETACCOUNTTYPE',
  'OFFSETACCOUNTDISPLAYVALUE',
  'OFFSETDEFAULTDIMENSIONDISPLAYVALUE',
  'OFFSETFINTAGDISPLAYVALUE',
  'OFFSETTEXT',
  'PREPAYMENT',
  'SALESTAXGROUP',
  'ITEMSALESTAXGROUP',
  'TAXEXEMPTNUMBER',
  'ISWITHHOLDINGCALCULATIONENABLED',
  'ITEMWITHHOLDINGTAXGROUPCODE',
  'DOCUMENT',
  'DOCUMENTDATE',
  'DUEDATE',
  'INVOICE',
  'PAYMENTMETHOD',
  'PAYMENTREFERENCE',
  'CASHDISCOUNT',
  'CASHDISCOUNTAMOUNT',
  'CASHDISCOUNTDATE',
  'EXCHANGERATESECONDARY',
  'OVERRIDESALESTAX',
  'PAYMENTID',
  'QUANTITY',
  'REPORTINGCURRENCYEXCHRATESECONDARY',
  'REPORTINGCURRENCYEXCHRATE',
  'REVERSEDATE',
  'REVERSEENTRY',
  'SALESTAXCODE',
  'POSTINGPROFILE',
  'POSTINGLAYER',
  'ISPOSTED',
  'SafeTransaction',
  'SafeType',
  'VoucherType',
] as const;

@Injectable()
export class CashOutTemplateValidationService {
  public getValidationErrors(headers: string[]): string[] {
    const normalized = headers.map((header) => String(header ?? '').trim());
    const counts = new Map<string, number>();
    for (const header of normalized) {
      counts.set(header, (counts.get(header) ?? 0) + 1);
    }

    const expected = new Set<string>(CASH_OUT_TEMPLATE_HEADERS);
    const actual = new Set(normalized.filter(Boolean));
    const missing = CASH_OUT_TEMPLATE_HEADERS.filter(
      (header) => !actual.has(header),
    );
    const unexpected = [...actual].filter((header) => !expected.has(header));
    const duplicates = [...counts.entries()]
      .filter(([header, count]) => Boolean(header) && count > 1)
      .map(([header]) => header);
    const blankHeaderCount = normalized.filter((header) => !header).length;

    if (
      missing.length === 0 &&
      unexpected.length === 0 &&
      duplicates.length === 0 &&
      blankHeaderCount === 0
    ) {
      return [];
    }

    const details = [
      missing.length ? `missing columns: ${missing.join(', ')}` : '',
      unexpected.length ? `unsupported columns: ${unexpected.join(', ')}` : '',
      duplicates.length ? `duplicate columns: ${duplicates.join(', ')}` : '',
      blankHeaderCount ? `${blankHeaderCount} blank column header(s)` : '',
    ].filter(Boolean);

    return [
      `Unsupported Cash Out Excel template (${details.join('; ')}). Use one of the approved 51-column Cash Out templates without changing its headers.`,
    ];
  }

  public assertSupported(headers: string[]): void {
    const [validationError] = this.getValidationErrors(headers);
    if (validationError) throw new BadRequestException(validationError);
  }
}
