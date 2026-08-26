import { DeleteDateColumn } from 'typeorm';
import { TimestampsEntity } from './timestamps.entity';

export abstract class SoftDeleteEntity extends TimestampsEntity {
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
