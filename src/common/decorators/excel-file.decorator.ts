// excel-file.decorator.ts
import { UploadedFile } from '@nestjs/common';

import { ExcelFilePipe } from '@/common/pipes/excel-file.pipe';

export function ExcelFile(fieldName = 'file'): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    UploadedFile(fieldName, new ExcelFilePipe())(
      target,
      propertyKey,
      parameterIndex,
    );
  };
}
