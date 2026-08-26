import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiResponse as ApiResponseDto } from './api-response';

export function ApiWrappedResponse<T>(model: Type<T>, status = 200) {
  return applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiResponse({
      status,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          { properties: { data: { $ref: getSchemaPath(model) } } },
        ],
      },
    }),
  );
}

export function ApiWrappedArrayResponse<T>(model: Type<T>, status = 200) {
  return applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiResponse({
      status,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          { properties: { 
            data: { 
              type: 'array', 
              items: { 
                $ref: getSchemaPath(model)
               }
            }
          } 
        },
        ],
      },
    }),
  );
}
