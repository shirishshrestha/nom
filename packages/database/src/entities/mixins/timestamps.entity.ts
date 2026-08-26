import { CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { PrimaryKeyEntity } from './primary-key.entity';

export abstract class TimestampsEntity extends PrimaryKeyEntity {
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
