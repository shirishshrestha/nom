import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Public: the global AuthGuard protects every route unless opted out.
  @AllowAnonymous()
  @Get()
  @ApiOperation({ summary: 'Health/hello check' })
  getHello(): string {
    return this.appService.getHello();
  }
}
