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
  transform(
    value: Express.Multer.File,
    _: ArgumentMetadata,
  ): Express.Multer.File {
    if (!value) {
      throw new BadRequestException('File is required');
    }

    if (!value.mimetype) {
      throw new BadRequestException('Invalid File type!');
    }

    // "value" is an object containing the file's attributes and metadata
    if (!ALLOWED_TYPES.includes(value.mimetype)) {
      throw new BadRequestException('File type not allowed');
    }

    if (!value.buffer?.length) {
      throw new BadRequestException('Excel file is empty or missing.');
    }

    return value;
  }
}
