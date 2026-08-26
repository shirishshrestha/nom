import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  AcceptLineItemDto,
  ApiResponse,
  DiscardDocumentResultDto,
  DocumentListDto,
  ExtractLineItemsResultDto,
  LineItemDto,
  LineItemGuidanceDto,
  LineItemLogDto,
  ListTransactionDocumentsQueryDto,
  MatchLineItemsResultDto,
  MatchQueuedDto,
  MatchStatusDto,
  ReviewCompletionResultDto,
  TransactionLineItemsDto,
  ValidateDocumentResultDto,
} from '@nom/dtos';
import { DOCUMENT_TYPES } from '@nom/shared';
import { DocumentsService } from '../documents/documents.service';
import { TransactionService } from './transaction.service';
import type { OrgSession } from '../auth/auth.types';
import { OrgSession as OrgSessionDecorator } from '../auth/org-session.decorator';
import {
  ApiAuthErrorResponse,
  ApiNotFoundResponse,
  ApiWrappedResponse,
} from '../common/api-wrapped-response';

@ApiTags('transaction')
@ApiAuthErrorResponse()
@Controller('transaction')
export class TransactionController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly transactionService: TransactionService,
  ) {}

  @ApiOperation({
    summary: 'Validate a transaction document',
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
      DOCUMENT_TYPES.TRANSACTION,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'List transaction documents',
    description:
      "The org's transaction documents, newest-first, with billed totals. Filter by vendor, status, and effective-date range; paginated.",
  })
  @ApiWrappedResponse(DocumentListDto)
  @Get('documents')
  async listDocuments(
    @OrgSessionDecorator() session: OrgSession,
    @Query() query: ListTransactionDocumentsQueryDto,
  ): Promise<ApiResponse<DocumentListDto>> {
    const data = await this.documentsService.listDocuments(
      session,
      DOCUMENT_TYPES.TRANSACTION,
      query,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Delete a transaction document',
    description:
      'Soft-deletes the invoice (marks it discarded). Committed documents cannot be deleted.',
  })
  @ApiWrappedResponse(DiscardDocumentResultDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @Delete('documents/:documentId')
  async deleteDocument(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<DiscardDocumentResultDto>> {
    const data = await this.documentsService.discardDocument(
      session,
      documentId,
      DOCUMENT_TYPES.TRANSACTION,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Mark review complete',
    description:
      'Mark this transaction document review complete (reviewStatus → Completed). Reversible.',
  })
  @ApiWrappedResponse(ReviewCompletionResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @Post('documents/:documentId/mark-reviewed')
  async markReviewed(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<ReviewCompletionResultDto>> {
    const data = await this.documentsService.setReviewCompleted(
      session,
      documentId,
      DOCUMENT_TYPES.TRANSACTION,
      true,
    );
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Unmark review complete',
    description:
      'Reopen a transaction document for review (reviewStatus → Pending).',
  })
  @ApiWrappedResponse(ReviewCompletionResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @Post('documents/:documentId/unmark-reviewed')
  async unmarkReviewed(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<ReviewCompletionResultDto>> {
    const data = await this.documentsService.setReviewCompleted(
      session,
      documentId,
      DOCUMENT_TYPES.TRANSACTION,
      false,
    );
    return new ApiResponse(data, 'success', 201);
  }

  @ApiOperation({
    summary: 'Extract line items',
    description: 'Extract billed line items and write them into the graph.',
  })
  @ApiWrappedResponse(ExtractLineItemsResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Validated document id.' })
  @Post('documents/:documentId/extract-line-items')
  async extractLineItems(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId') documentId: string,
  ): Promise<ApiResponse<ExtractLineItemsResultDto>> {
    const data = await this.transactionService.extractLineItems(
      session,
      documentId,
    );
    return new ApiResponse(data, 'success', 201);
  }

  /**
   * Reconciles billed line items against the vendor's rate card (BILLED_AS /
   * REFERENCES edges + audit trail). Requires line items to be extracted (committed).
   */
  @ApiOperation({
    summary: 'Match line items',
    description:
      'Link each billed line to a canonical service or to the sibling lines its amount is computed from, and write the audit trail back onto each line.',
  })
  @ApiWrappedResponse(MatchLineItemsResultDto, 201)
  @ApiNotFoundResponse()
  @ApiParam({
    name: 'documentId',
    description: 'Committed transaction document id.',
  })
  @Post('documents/:documentId/match-line-items')
  async matchLineItems(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<MatchLineItemsResultDto | MatchQueuedDto>> {
    const data = await this.transactionService.matchLineItems(
      session,
      documentId,
    );
    // 202 when the match was enqueued for the background worker; 201 when run inline.
    const code = 'serviceMatchCount' in data ? 201 : 202;
    return new ApiResponse(data, 'success', code);
  }

  @ApiOperation({
    summary: 'Get match status',
    description:
      'Poll after starting background matching: matching = in flight, matched = done (fetch line items), committed = not matching / reverted on failure.',
  })
  @ApiWrappedResponse(MatchStatusDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @Get('documents/:documentId/match-status')
  async getMatchStatus(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<MatchStatusDto>> {
    const data = await this.transactionService.getMatchStatus(
      session,
      documentId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Get line items',
    description:
      'The line items written to the graph for this document, by invoice.',
  })
  @ApiWrappedResponse(TransactionLineItemsDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @Get('documents/:documentId/line-items')
  async getLineItems(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<ApiResponse<TransactionLineItemsDto>> {
    const data = await this.transactionService.getLineItems(
      session.session.activeOrganizationId,
      documentId,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Submit reviewer guidance for a line item',
    description:
      "Store a reviewer's correction on a mismatched / needs-review line and re-run " +
      'matching for that line only. Guidance persists and is re-applied on every rerun.',
  })
  @ApiWrappedResponse(LineItemDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @ApiParam({ name: 'lineItemId', description: 'Line item id.' })
  @Post('documents/:documentId/line-items/:lineItemId/guidance')
  async submitLineItemGuidance(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Param('lineItemId', new ParseUUIDPipe()) lineItemId: string,
    @Body() dto: LineItemGuidanceDto,
  ): Promise<ApiResponse<LineItemDto>> {
    const data = await this.transactionService.submitLineItemGuidance(
      session,
      documentId,
      lineItemId,
      dto.guidance,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Accept a line item mismatch',
    description:
      "Accept a flagged line's discrepancy as-is: status → accepted (the prior status is kept " +
      'on the line for the audit trail) and an acceptance entry is appended to the audit log. ' +
      'Idempotent — a repeat accept succeeds without a duplicate log entry.',
  })
  @ApiWrappedResponse(LineItemDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @ApiParam({ name: 'lineItemId', description: 'Line item id.' })
  @Post('documents/:documentId/line-items/:lineItemId/accept')
  async acceptLineItem(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Param('lineItemId', new ParseUUIDPipe()) lineItemId: string,
    @Body() dto: AcceptLineItemDto,
  ): Promise<ApiResponse<LineItemDto>> {
    const data = await this.transactionService.acceptLineItem(
      session,
      documentId,
      lineItemId,
      dto.reasonForAcceptance,
    );
    return new ApiResponse(data);
  }

  @ApiOperation({
    summary: 'Get a line item audit log',
    description:
      "On-demand full audit trail for one line item. Kept out of the line-items list (which is lean) and fetched only when a reviewer opens the line's log.",
  })
  @ApiWrappedResponse(LineItemLogDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'documentId', description: 'Transaction document id.' })
  @ApiParam({ name: 'lineItemId', description: 'Line item id.' })
  @Get('documents/:documentId/line-items/:lineItemId/logs')
  async getLineItemLog(
    @OrgSessionDecorator() session: OrgSession,
    @Param('documentId', new ParseUUIDPipe()) _documentId: string,
    @Param('lineItemId', new ParseUUIDPipe()) lineItemId: string,
  ): Promise<ApiResponse<LineItemLogDto>> {
    const data = await this.transactionService.getLineItemLog(
      session.session.activeOrganizationId,
      lineItemId,
    );
    return new ApiResponse(data);
  }
}
