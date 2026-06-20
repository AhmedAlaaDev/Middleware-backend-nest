import { DynDataModel as IDynDataModel } from '@/modules/entry-processor/interfaces';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';
import { IMissingMasterDataItem } from '@/modules/data-batch/interfaces/data-batch-missing-master-data.interface';

export abstract class DynDataModel implements IDynDataModel {
  LineNumber?: number;

  DimensionModel?: EntryDimensionsModel;
  SourceIds: string[] = [];

  private errors: Array<{ property: string; message: string }> = [];
  private missingMasterData: IMissingMasterDataItem[] = [];

  get ErrorCount(): number {
    return this.errors.length;
  }

  GetErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }

  get ErrorsText(): string {
    if (this.ErrorCount === 0) {
      return '';
    }
    return this.GetErrors().join(';');
  }

  AddError(property: string, message: string): void {
    this.errors.push({ property, message });
  }

  AddMissingMasterData(input: IMissingMasterDataItem): void {
    const exists = this.missingMasterData.some(
      (m) =>
        m.type === input.type &&
        m.missingField === input.missingField &&
        m.missingValue === input.missingValue,
    );
    if (!exists) {
      this.missingMasterData.push(input);
    }
  }

  GetMissingMasterData(): IMissingMasterDataItem[] {
    return this.missingMasterData;
  }
}
