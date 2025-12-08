import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { DynDataModel as IDynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';

export abstract class DynDataModel implements IDynDataModel {
  LineNumber?: number;
  DimensionModel?: AccountDimensionsModel;
  SourceIds: string[] = [];

  private errors: Array<{ property: string; message: string }> = [];

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
}

