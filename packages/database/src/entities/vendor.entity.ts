import { Column, Entity, OneToMany } from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationScopedEntity } from './mixins/organization-scoped.entity';
import { FileEntity } from './file.entity';

@Entity('vendors')
export class VendorEntity extends OrganizationScopedEntity {
  @ApiProperty()
  @Column({ type: 'text' })
  name!: string;

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  code?: string;

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  type?: string;

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  location?: string;

  @ApiPropertyOptional()
  @Column({ type: 'text', nullable: true })
  comments?: string;

  @OneToMany(() => FileEntity, (file) => file.vendor)
  files!: FileEntity[];
}
