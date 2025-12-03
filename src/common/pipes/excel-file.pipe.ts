import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

const ALLOWED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

@Injectable()
export class ExcelFilePipe implements PipeTransform {
  transform(value: MulterFile, _: ArgumentMetadata): MulterFile {
    // "value" is an object containing the file's attributes and metadata
    if (!ALLOWED_TYPES.includes(value.mimetype)) {
      throw new BadRequestException('File type not allowed');
    }

    return value;
  }
}
