import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { ApiResponse } from '@nom/dtos';
import {
  ApiWrappedResponse,
  ApiWrappedArrayResponse,
  ApiAuthErrorResponse,
  ApiNotFoundResponse,
  ApiDeletedResponse,
} from '../common/api-wrapped-response';
import {
  CreateVendorDto,
  UpdateVendorDto,
  CurrentServicesResultDto,
  ListCurrentServicesQueryDto,
  ListVendorFilesQueryDto,
} from '@nom/dtos';
import { FileEntity, VendorEntity } from '@nom/database';
import type { OrgSession } from '../auth/auth.types';
import { OrgSession as OrgSessionDecorator } from '../auth/org-session.decorator';

@ApiTags('vendors')
@ApiAuthErrorResponse()
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @ApiOperation({
    summary: 'Create a vendor',
    description: 'Register a vendor (also mirrored to the graph).',
  })
  @ApiWrappedResponse(VendorEntity, 201)
  @Post()
  async create(
    @OrgSessionDecorator() session: OrgSession,
    @Body() dto: CreateVendorDto,
  ): Promise<ApiResponse<VendorEntity>> {
    const data = await this.vendorsService.create(session, dto);
    return new ApiResponse(data, 'Vendor created', 201);
  }

  @ApiOperation({
    summary: 'List vendors',
    description: "List the org's vendors.",
  })
  @ApiWrappedArrayResponse(VendorEntity)
  @Get()
  async findAll(
    @OrgSessionDecorator() session: OrgSession,
  ): Promise<ApiResponse<VendorEntity[]>> {
    const data = await this.vendorsService.findAll(session);
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'List vendor types',
    description: 'Distinct vendor type values in use.',
  })
  @SwaggerApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { type: 'array', items: { type: 'string' } },
        message: { type: 'string', example: 'success' },
        status: { type: 'number', example: 200 },
      },
    },
  })
  @Get('types')
  async findTypes(
    @OrgSessionDecorator() session: OrgSession,
  ): Promise<ApiResponse<string[]>> {
    const data = await this.vendorsService.listVendorTypes(session);
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Get a vendor',
    description: 'Fetch one vendor by id.',
  })
  @ApiWrappedResponse(VendorEntity)
  @ApiNotFoundResponse()
  @Get(':id')
  async findOne(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
  ): Promise<ApiResponse<VendorEntity>> {
    const data = await this.vendorsService.findOne(session, id);
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: "List a vendor's files",
    description: 'Files uploaded for this vendor.',
  })
  @ApiWrappedArrayResponse(FileEntity)
  @ApiNotFoundResponse()
  @Get(':id/files')
  async findFiles(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
    @Query() query: ListVendorFilesQueryDto,
  ): Promise<ApiResponse<FileEntity[]>> {
    const data = await this.vendorsService.findFiles(
      session,
      id,
      query.documentType,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: "List a vendor's current services",
    description:
      'Current (non-amended) committed services a vendor offers — the live rate card, ' +
      'grouped by canonical concept and paginated over the groups (limit/offset/total), ' +
      "with the vendor's attribute-set definition embedded as metadata.",
  })
  @ApiWrappedResponse(CurrentServicesResultDto)
  @ApiNotFoundResponse()
  @Get(':id/services')
  async findServices(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListCurrentServicesQueryDto,
  ): Promise<ApiResponse<CurrentServicesResultDto>> {
    const data = await this.vendorsService.listCurrentServices(session, id, {
      limit: query.limit,
      offset: query.offset,
      fileId: query.fileId,
      model: query.model,
      q: query.q,
    });
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Update a vendor',
    description: "Update a vendor's fields.",
  })
  @ApiWrappedResponse(VendorEntity)
  @ApiNotFoundResponse()
  @Patch(':id')
  async update(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
  ): Promise<ApiResponse<VendorEntity>> {
    const data = await this.vendorsService.update(session, id, dto);
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Delete a vendor',
    description: 'Soft-delete a vendor by id.',
  })
  @ApiDeletedResponse()
  @ApiNotFoundResponse()
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
  ): Promise<ApiResponse<null>> {
    await this.vendorsService.remove(session, id);
    return new ApiResponse(null);
  }
}
