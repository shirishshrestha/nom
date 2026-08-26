import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiResponse,
  CommittedServicesResultDto,
  CommitAllDto,
  CommitAllResultDto,
  ContentChunkDto,
  EditCommittedServiceDto,
  DiscardDocumentsDto,
  DiscardDocumentsResultDto,
  DocumentListDto,
  ExtractServicesResultDto,
  LatestUncommittedResultDto,
  ReviewStatusResultDto,
  SaveServicesDto,
  SaveServicesResultDto,
  UncommittedDocumentsResultDto,
  ValidateDocumentResultDto,
} from '@nom/dtos';
import { DOCUMENT_TYPES } from '@nom/shared';
import { DocumentsService } from '../documents/documents.service';
import { SourceService } from './source.service';
import type { OrgSession } from '../auth/auth.types';
import { OrgSession as OrgSessionDecorator } from '../auth/org-session.decorator';
import {
  ApiAuthErrorResponse,
  ApiNotFoundResponse,
  ApiWrappedResponse,
} from '../common/api-wrapped-response';

@ApiTags('source')
@ApiAuthErrorResponse()
@Controller('source')
export class SourceController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly sourceService: SourceService,
  ) {}

  @ApiOperation({
    summary: 'Validate a document',
    description:
      'Financial hard-gate + AI vendor-match, then mirror to the graph. Re-runnable.',
  })
  @ApiWrappedResponse(ValidateDocumentResultDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Extracted document id.' })
  @Post('documents/:documentId/validate')
  async validate(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId') documentId: string,
  ): Promise<ApiResponse<ValidateDocumentResultDto>> {
    const data = await this.documentsService.validate(
      session,
      documentId,
      DOCUMENT_TYPES.SOURCE,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'List source documents',
    description: "The org's source documents, newest-first.",
  })
  @ApiWrappedResponse(DocumentListDto)
  @Get('documents')
  async listDocuments(
    @OrgSessionDecorator() session: OrgSession,
  ): Promise<ApiResponse<DocumentListDto>> {
    const data = await this.documentsService.listDocuments(
      session,
      DOCUMENT_TYPES.SOURCE,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'List uncommitted documents',
    description:
      "A vendor's source docs whose latest staged services aren't committed yet, " +
      'for rehydrating the review editor.',
  })
  @ApiWrappedResponse(UncommittedDocumentsResultDto)
  @Get('uncommitted')
  async listUncommitted(
    @OrgSessionDecorator() session: OrgSession,
    @Query('vendorId', new ParseUUIDPipe()) vendorId: string,
  ): Promise<ApiResponse<UncommittedDocumentsResultDto>> {
    const data = await this.sourceService.listUncommittedForVendor(
      session.session.activeOrganizationId,
      vendorId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Latest uncommitted document (any vendor)',
    description:
      "The org's single most-recently-touched uncommitted source doc across all " +
      'vendors, for resuming the review editor without a vendorId.',
  })
  @ApiWrappedResponse(LatestUncommittedResultDto)
  @Get('uncommitted/latest')
  async listLatestUncommitted(
    @OrgSessionDecorator() session: OrgSession,
  ): Promise<ApiResponse<LatestUncommittedResultDto>> {
    const data = await this.sourceService.findLatestUncommittedDocument(
      session.session.activeOrganizationId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Discard a change-set',
    description:
      "Discard a vendor's entire uncommitted change-set (one or more in-review docs).",
  })
  @ApiWrappedResponse(DiscardDocumentsResultDto)
  @Post('discard')
  async discard(
    @OrgSessionDecorator() session: OrgSession,
    @Body() dto: DiscardDocumentsDto,
  ): Promise<ApiResponse<DiscardDocumentsResultDto>> {
    const data = await this.sourceService.discardUncommittedForVendor(
      session.session.activeOrganizationId,
      dto.vendorId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Get a content chunk',
    description:
      'Fetch one content chunk (where a service line was extracted from) by id.',
  })
  @ApiWrappedResponse(ContentChunkDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'contentId', description: 'Content chunk id.' })
  @Get('content/:contentId')
  async getContentChunk(
    @OrgSessionDecorator() session: OrgSession,
    @Param('contentId', new ParseUUIDPipe()) contentId: string,
  ): Promise<ApiResponse<ContentChunkDto>> {
    const data = await this.sourceService.getContentChunk(
      session.session.activeOrganizationId,
      contentId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Extract services',
    description:
      'Extract priced service line-items into a versioned staging snapshot.',
  })
  @ApiWrappedResponse(ExtractServicesResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Extracted document id.' })
  @Post('documents/:documentId/extract-services')
  async extractServices(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId') documentId: string,
  ): Promise<ApiResponse<ExtractServicesResultDto>> {
    const data = await this.sourceService.extractServices(session, documentId);
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Save services',
    description:
      'Promote the reviewed services into Neo4j (commit the change-set).',
  })
  @ApiWrappedResponse(SaveServicesResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Extracted document id.' })
  @Post('documents/:documentId/save-services')
  async saveServices(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId') documentId: string,
    @Body() dto: SaveServicesDto,
  ): Promise<ApiResponse<SaveServicesResultDto>> {
    const data = await this.sourceService.saveStagedServices(
      session,
      documentId,
      dto.services,
      dto.deletedServiceIds ?? [],
    );
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Get committed services',
    description:
      "A committed document's services (with graph node ids) + the attribute set, for the committed-service edit UI.",
  })
  @ApiWrappedResponse(CommittedServicesResultDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Committed document id.' })
  @Get('documents/:documentId/services')
  async getCommittedServices(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<CommittedServicesResultDto>> {
    const data = await this.sourceService.getCommittedServices(
      session.session.activeOrganizationId,
      documentId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Edit a committed service',
    description:
      'Edit one already-committed service: re-commits as a new graph node and retires + AMENDS-links the prior one.',
  })
  @ApiWrappedResponse(SaveServicesResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Committed document id.' })
  @ApiParam({
    name: 'serviceId',
    description: 'Committed service (graph node) id.',
  })
  @Patch('documents/:documentId/services/:serviceId')
  async editCommittedService(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Body() dto: EditCommittedServiceDto,
  ): Promise<ApiResponse<SaveServicesResultDto>> {
    const data = await this.sourceService.editCommittedService(
      session,
      documentId,
      serviceId,
      dto,
    );
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Mark ready to commit',
    description:
      "Save the reviewer's edits and park the document as ready_to_commit — no graph write. Reversible.",
  })
  @ApiWrappedResponse(ReviewStatusResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Extracted document id.' })
  @Post('documents/:documentId/mark-ready')
  async markReady(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId') documentId: string,
    @Body() dto: SaveServicesDto,
  ): Promise<ApiResponse<ReviewStatusResultDto>> {
    const data = await this.sourceService.markReady(
      session,
      documentId,
      dto.services,
      dto.deletedServiceIds ?? [],
    );
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Unmark ready to commit',
    description:
      'Move a ready_to_commit document back to staged for more review.',
  })
  @ApiWrappedResponse(ReviewStatusResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Extracted document id.' })
  @Post('documents/:documentId/unmark-ready')
  async unmarkReady(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId') documentId: string,
  ): Promise<ApiResponse<ReviewStatusResultDto>> {
    const data = await this.sourceService.unmarkReady(session, documentId);
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Commit all ready documents',
    description:
      'Promote every reviewer-accepted (ready_to_commit) staged row into Neo4j. Per-doc independent: a failure is reported, not fatal.',
  })
  @ApiWrappedResponse(CommitAllResultDto, 201)
  @Post('commit-all')
  async commitAll(
    @OrgSessionDecorator() session: OrgSession,
    @Body() dto: CommitAllDto,
  ): Promise<ApiResponse<CommitAllResultDto>> {
    const data = await this.sourceService.commitAll(
      session,
      dto.vendorId,
      dto.stagedIds,
    );
    return new ApiResponse(data, 'success', 201);
  }
}
