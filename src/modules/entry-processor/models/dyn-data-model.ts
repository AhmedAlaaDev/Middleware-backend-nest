import { DynDataModel as IDynDataModel } from '@/modules/entry-processor/interfaces';
import { EntryDimensionsModel } from '@/modules/entry-processor/models';

export abstract class DynDataModel implements IDynDataModel {
  LineNumber?: number;

  DimensionModel?: EntryDimensionsModel;
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
