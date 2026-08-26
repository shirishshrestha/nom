import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse as SwaggerApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  ApiAuthErrorResponse,
  ApiNotFoundResponse,
  ApiDeletedResponse,
} from '../common/api-wrapped-response';
import { FilesService } from './files.service';
import { ApiResponse, ExtractDocumentsDto, ExtractResultDto } from '@nom/dtos';
import { ConfirmFileDto, PresignFileDto, UpdateFileDto } from '@nom/dtos';
import { FileEntity } from '@nom/database';
import { DocumentsService } from '../documents/documents.service';
import type { OrgSession } from '../auth/auth.types';
import type { ExtractResult } from '../common/types';
import { OrgSession as OrgSessionDecorator } from '../auth/org-session.decorator';
import {
  ApiWrappedResponse,
  ApiWrappedArrayResponse,
} from '../common/api-wrapped-response';

@ApiTags('files')
@ApiAuthErrorResponse()
@ApiExtraModels(FileEntity)
@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly documentsService: DocumentsService,
  ) {}

  // Extract metadata + content chunks from raw files. The document type is taken
  // from each file (set at upload), so the caller only supplies file ids.
  @ApiOperation({
    summary: 'Extract metadata',
    description:
      'Run the multimodal extractor over the given uploaded files, persisting a ' +
      'document (status=extracted) + its content chunks for each.',
  })
  @ApiWrappedArrayResponse(ExtractResultDto, 201)
  @Post('extract-metadata')
  async extractMetadata(
    @OrgSessionDecorator() session: OrgSession,
    @Body() dto: ExtractDocumentsDto,
  ): Promise<ApiResponse<ExtractResult[]>> {
    const data = await this.documentsService.extractMetadata(
      session,
      dto.fileIds,
    );
    return new ApiResponse<ExtractResult[]>(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Extract metadata (single file)',
    description: 'Same as POST /files/extract-metadata for one file.',
  })
  @ApiWrappedResponse(ExtractResultDto, 201)
  @ApiParam({ name: 'id', description: 'File id to extract metadata from.' })
  @Post(':id/extract-metadata')
  async extractMetadataSingle(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
  ): Promise<ApiResponse<ExtractResult>> {
    const [data] = await this.documentsService.extractMetadata(session, [id]);
    return new ApiResponse<ExtractResult>(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Presign an upload',
    description:
      'Create a pending file row and return a presigned S3 URL the client uploads the bytes to.',
  })
  @SwaggerApiResponse({
    status: 201,
    schema: {
      allOf: [
        { $ref: getSchemaPath(FileEntity) },
        { properties: { uploadUrl: { type: 'string' } } },
      ],
    },
  })
  @Post('presign')
  async presign(
    @OrgSessionDecorator() session: OrgSession,
    @Body() dto: PresignFileDto,
  ): Promise<ApiResponse<{ file: FileEntity; uploadUrl: string }>> {
    const data = await this.filesService.presign(session, dto);
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Confirm many files',
    description:
      'Mark several uploaded files as confirmed and link them to a vendor.',
  })
  @ApiWrappedArrayResponse(FileEntity, 201)
  @Post('confirm-many')
  async confirmMany(
    @OrgSessionDecorator() session: OrgSession,
    @Body() body: { vendorId: string; ids: string[] },
  ): Promise<ApiResponse<FileEntity[]>> {
    const data = await this.filesService.confirmMany(
      session,
      body.vendorId,
      body.ids,
    );
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Confirm a file',
    description:
      'Mark a single uploaded file as confirmed and link it to a vendor.',
  })
  @ApiWrappedResponse(FileEntity, 201)
  @Post(':id/confirm')
  async confirm(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
    @Body() body: ConfirmFileDto,
  ): Promise<ApiResponse<FileEntity>> {
    const data = await this.filesService.confirm(session, body.vendorId, id);
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Get a download URL',
    description: 'Return a presigned S3 URL to download the file.',
  })
  @SwaggerApiResponse({
    status: 200,
    schema: {
      properties: { data: { properties: { url: { type: 'string' } } } },
    },
  })
  @Get(':id/url')
  async getDownloadUrl(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ url: string }>> {
    const data = await this.filesService.getDownloadUrl(session, id);
    return new ApiResponse(data);
  }

  @ApiOperation({ summary: 'List files', description: "List the org's files." })
  @ApiWrappedArrayResponse(FileEntity)
  @Get()
  async findAll(
    @OrgSessionDecorator() session: OrgSession,
  ): Promise<ApiResponse<FileEntity[]>> {
    const data = await this.filesService.findAll(session);
    return new ApiResponse(data);
  }

  @ApiOperation({ summary: 'Get a file', description: 'Fetch one file by id.' })
  @ApiWrappedResponse(FileEntity)
  @ApiNotFoundResponse()
  @Get(':id')
  async findOne(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
  ): Promise<ApiResponse<FileEntity>> {
    const data = await this.filesService.findOne(session, id);
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Update a file',
    description: "Update a file's metadata (e.g. name).",
  })
  @ApiWrappedResponse(FileEntity)
  @ApiNotFoundResponse()
  @Patch(':id')
  async update(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
    @Body() updateFileDto: UpdateFileDto,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.filesService.update(session, id, updateFileDto);
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Delete a file',
    description: 'Soft-delete a file by id.',
  })
  @ApiDeletedResponse()
  @ApiNotFoundResponse()
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @OrgSessionDecorator() session: OrgSession,
    @Param('id') id: string,
  ): Promise<ApiResponse<null>> {
    await this.filesService.remove(session, id);
    return new ApiResponse(null);
  }
}
