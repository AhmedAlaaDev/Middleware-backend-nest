import { AccountReceivableFileModel } from './account-receivable-file.model';

describe('AccountReceivableFileModel', () => {
  describe('fromLookupRow', () => {
    it('unwraps lookup cells across imported row properties', () => {
      const model = AccountReceivableFileModel.fromLookupRow({
        LINENUMBER: { formula: 'ROW()', result: 12 },
        INVOICE: {
          formula: '[1]!Ledger_Accrual[[#This Row],[Invoice]]',
          result: '000009397/OR-TR',
        },
        DEFAULTDIMENSIONDISPLAYVALUE: {
          formula:
            'IF([1]!Ledger_Accrual[[#This Row],[ACCOUNTTYPE]]="Cust",[1]!Ledger_Accrual[[#This Row],[Dimension Merge]],"")',
          result: '|2101|021|CAI|005|101001088|',
        },
        ITEMSALESTAXGROUP: { formula: 'IF(FALSE,"VAT-0%","")' },
      });

      expect(model.LINENUMBER).toBe(12);
      expect(model.INVOICE).toBe('000009397/OR-TR');
      expect(model.DEFAULTDIMENSIONDISPLAYVALUE).toBe(
        '|2101|021|CAI|005|101001088|',
      );
      expect(model.ITEMSALESTAXGROUP).toBe('');
    });
  });

  describe('assignLookupResults', () => {
    it('scans source properties into the current model', () => {
      const model = new AccountReceivableFileModel();

      model.assignLookupResults({
        ACCOUNTTYPE: { formula: 'A1', result: 'Cust' },
      });

      expect(model.ACCOUNTTYPE).toBe('Cust');
    });
  });

  describe('modifiedLocationHeaderDefaultDimensionDisplayValue', () => {
    it.each([
      ['plain string', '|2101|CAI|002|', '|2101|002|002|'],
      [
        'formula string result',
        {
          formula:
            'IF([1]!Ledger_Accrual[[#This Row],[ACCOUNTTYPE]]="Cust",[1]!Ledger_Accrual[[#This Row],[Dimension Merge]],"")',
          result: '|2101|021|CAI|005|101001088|',
        },
        '|2101|021|002|005|101001088|',
      ],
      ['formula numeric result', { formula: 'SUM(50,3)', result: 53 }, '53'],
    ])('normalizes %s values', (_scenario, sourceValue, expectedValue) => {
      const model = new AccountReceivableFileModel();
      model.DEFAULTDIMENSIONDISPLAYVALUE = sourceValue;

      expect(model.modifiedLocationHeaderDefaultDimensionDisplayValue()).toBe(
        expectedValue,
      );
    });

    it('returns an empty string for formula cells without a result', () => {
      const model = new AccountReceivableFileModel();
      model.DEFAULTDIMENSIONDISPLAYVALUE = {
        formula:
          'IF([1]!Ledger_Accrual[[#This Row],[ACCOUNTTYPE]]="Cust",[1]!Ledger_Accrual[[#This Row],[Dimension Merge]],"")',
      };

      expect(model.modifiedLocationHeaderDefaultDimensionDisplayValue()).toBe(
        '',
      );
    });
  });
});
