import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { Session as SessionDecorator } from '@thallesp/nestjs-better-auth';
import type { OrgSession as OrgSessionType, Session } from './auth.types.js';

@Injectable()
export class OrgSessionPipe implements PipeTransform<Session, OrgSessionType> {
  transform(session: Session): OrgSessionType {
    if (!session?.session?.activeOrganizationId)
      throw new NotFoundException('No active organization');
    return session as OrgSessionType;
  }
}

export const OrgSession = () => SessionDecorator(new OrgSessionPipe());
