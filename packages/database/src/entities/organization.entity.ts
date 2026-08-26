import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('organization', { synchronize: false })
export class OrganizationEntity {
  @PrimaryColumn({ type: 'text' }) id!: string;
  @Column({ type: 'text' }) name!: string;
  @Column({ type: 'text' }) slug!: string;
  @Column({ type: 'text', nullable: true }) logo?: string;
  @Column({ type: 'timestamptz' }) createdAt!: Date;
}
