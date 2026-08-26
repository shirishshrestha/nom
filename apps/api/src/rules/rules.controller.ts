import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiResponse, CreateRuleDto, RuleDto, UpdateRuleDto } from '@nom/dtos';
import { RulesService } from './rules.service';
import type { OrgSession } from '../auth/auth.types';
import { OrgSession as OrgSessionDecorator } from '../auth/org-session.decorator';
import {
  ApiAuthErrorResponse,
  ApiDeletedResponse,
  ApiNotFoundResponse,
  ApiWrappedArrayResponse,
  ApiWrappedResponse,
} from '../common/api-wrapped-response';

@ApiTags('rules')
@ApiAuthErrorResponse()
@Controller('vendors/:vendorId/rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @ApiOperation({
    summary: "List a vendor's rules",
    description:
      "The vendor's rules, newest-first. Pass `search` for Lucene relevance over title + content.",
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiWrappedArrayResponse(RuleDto)
  @ApiNotFoundResponse()
  @Get()
  async list(
    @OrgSessionDecorator() session: OrgSession,
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Query('search') search?: string,
  ): Promise<ApiResponse<RuleDto[]>> {
    const data = await this.rulesService.list(session, vendorId, search);
    return new ApiResponse(data);
  }

  @ApiOperation({ summary: 'Create a rule' })
  @ApiWrappedResponse(RuleDto, 201)
  @ApiNotFoundResponse()
  @Post()
  async create(
    @OrgSessionDecorator() session: OrgSession,
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Body() dto: CreateRuleDto,
  ): Promise<ApiResponse<RuleDto>> {
    const data = await this.rulesService.create(session, vendorId, dto);
    return new ApiResponse(data, 'Rule created', 201);
  }

  @ApiOperation({ summary: 'Update a rule' })
  @ApiWrappedResponse(RuleDto)
  @ApiNotFoundResponse()
  @ApiParam({ name: 'id', description: 'Rule id.' })
  @Patch(':id')
  async update(
    @OrgSessionDecorator() session: OrgSession,
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRuleDto,
  ): Promise<ApiResponse<RuleDto>> {
    const data = await this.rulesService.update(session, vendorId, id, dto);
    return new ApiResponse(data);
  }

  @ApiOperation({ summary: 'Delete a rule' })
  @ApiDeletedResponse()
  @ApiNotFoundResponse()
  @ApiParam({ name: 'id', description: 'Rule id.' })
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @OrgSessionDecorator() session: OrgSession,
    @Param('vendorId', new ParseUUIDPipe()) vendorId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiResponse<null>> {
    await this.rulesService.remove(session, vendorId, id);
    return new ApiResponse(null);
  }
}
