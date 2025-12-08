import { AccountDimensionsModel } from '@/modules/entry-processor/models/account-dimensions.model';
import { DynDataModel as IDynDataModel } from '@/modules/entry-processor/interfaces/entry-processor.interface';

export abstract class DynDataModel implements IDynDataModel {
  lineNumber?: number;
  dimensionModel?: AccountDimensionsModel;
  sourceIds: string[] = [];

  private errors: Array<{ property: string; message: string }> = [];

  get errorCount(): number {
    return this.errors.length;
  }

  getErrors(): string[] {
    return this.errors.map((e) => `${e.property}: ${e.message}`);
  }

  addError(property: string, message: string): void {
    this.errors.push({ property, message });
  }
}

