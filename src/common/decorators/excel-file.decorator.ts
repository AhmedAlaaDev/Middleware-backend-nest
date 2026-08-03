// excel-file.decorator.ts
import { UploadedFile } from '@nestjs/common';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';

/**
 * Bound file from FileInterceptor. Do not pass a field name here — the
 * interceptor already selects `dataFile` / `file`; a mismatched name can yield
 * an empty upload that later blows up inside ExcelJS.
 */
export function ExcelFile(): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    UploadedFile(new ExcelFilePipe())(target, propertyKey, parameterIndex);
  };
}
