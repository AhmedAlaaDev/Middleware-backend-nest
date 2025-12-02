import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsExcelFile', async: false })
export class IsExcelFile implements ValidatorConstraintInterface {
  validate(file: MulterFile) {
    if (!file) return false;

    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];

    return allowedMimeTypes.includes(file.mimetype);
  }

  defaultMessage() {
    return 'dataFile must be an Excel file (.xlsx or .xls)';
  }
}
