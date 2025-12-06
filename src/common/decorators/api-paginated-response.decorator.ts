import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

import { IPaginatedRes } from '@/common/interfaces/paginated-res.interface';

export function ApiPaginatedResponse<TModel extends Type<any>>(model: TModel) {
  return applyDecorators(
    ApiExtraModels(IPaginatedRes, model),
    ApiOkResponse({
      schema: {
        allOf: [{ $ref: getSchemaPath(IPaginatedRes) }],
        properties: {
          items: {
            type: 'array',
            items: { $ref: getSchemaPath(model) },
          },
        },
      },
    }),
  );
}
