import { CashEntryRawDataModel } from '@/modules/cash/models/cash-entry-raw-data.model';
import { CustodyIssueBuilder } from './custody-issue.builder';
import { prepareCustodyIssueLines } from './custody-issue.processor';

describe('CustodyIssueBuilder', () => {
  it('preserves one output line for every source line', () => {
    const first = Object.create(
      CashEntryRawDataModel.prototype,
    ) as CashEntryRawDataModel;
    const second = Object.create(
      CashEntryRawDataModel.prototype,
    ) as CashEntryRawDataModel;
    const buildSourceLine = jest.fn((_id, source) => ({ source }) as any);

    const result = new CustodyIssueBuilder(buildSourceLine).build('466765', [
      first,
      second,
    ]);

    expect(result).toHaveLength(2);
    expect(buildSourceLine).toHaveBeenCalledTimes(2);
    expect(result.map((line: any) => line.source)).toEqual([first, second]);
  });
});

describe('prepareCustodyIssueLines', () => {
  it('keeps the existing one-source-row-to-one-output-row behavior', () => {
    const first = Object.create(
      CashEntryRawDataModel.prototype,
    ) as CashEntryRawDataModel;
    const second = Object.create(
      CashEntryRawDataModel.prototype,
    ) as CashEntryRawDataModel;

    expect(prepareCustodyIssueLines([first, second])).toEqual([
      { line: first },
      { line: second },
    ]);
  });
});
