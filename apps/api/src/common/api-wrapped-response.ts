import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiResponse as ApiResponseDto } from '@nom/dtos';

const errorSchema = {
  properties: {
    statusCode: { type: 'number' },
    message: { type: 'string' },
    error: { type: 'string' },
  },
};

export const ApiAuthErrorResponse = () =>
  ApiResponse({
    status: 401,
    description: 'Unauthorized',
    schema: errorSchema,
  });

export const ApiNotFoundResponse = () =>
  ApiResponse({ status: 404, description: 'Not found', schema: errorSchema });

export const ApiDeletedResponse = () =>
  ApiResponse({ status: 204, description: 'Deleted' });

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
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
}
