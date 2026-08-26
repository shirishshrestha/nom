import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiResponse, DashboardDto } from '@nom/dtos';
import { DashboardService } from './dashboard.service';
import type { OrgSession } from '../auth/auth.types';
import { OrgSession as OrgSessionDecorator } from '../auth/org-session.decorator';
import {
  ApiAuthErrorResponse,
  ApiWrappedResponse,
} from '../common/api-wrapped-response';

@ApiTags('dashboard')
@ApiAuthErrorResponse()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({
    summary: 'Dashboard metrics',
    description:
      'Aggregated KPI cards (overcharges, verification accuracy, exceptions, avg flags/file) plus upload-card status, computed live for the active org.',
  })
  @ApiWrappedResponse(DashboardDto)
  @Get()
  async getDashboard(
    @OrgSessionDecorator() session: OrgSession,
  ): Promise<ApiResponse<DashboardDto>> {
    const data = await this.dashboardService.getDashboard(session);
    return new ApiResponse(data);
  }
}
