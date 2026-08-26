import { Column, Index } from 'typeorm';
import { SoftDeleteEntity } from './soft-delete.entity';

export abstract class OrganizationScopedEntity extends SoftDeleteEntity {
  @Index()
  @Column({ type: 'text' })
  organizationId!: string;
}
