import { NotFoundException } from '@nestjs/common';
import { OrgSessionPipe } from '../auth/org-session.decorator';
import type { Session } from '../auth/auth.types';

const pipe = new OrgSessionPipe();

const withOrg = { session: { activeOrganizationId: 'org-1' } } as Session;

describe('OrgSessionPipe', () => {
  it('passes through when activeOrganizationId is set', () => {
    expect(pipe.transform(withOrg)).toBe(withOrg);
  });

  it('throws NotFoundException when activeOrganizationId is missing', () => {
    expect(() => pipe.transform({ session: {} } as Session)).toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when session is null', () => {
    expect(() => pipe.transform(null as unknown as Session)).toThrow(
      NotFoundException,
    );
  });
});
