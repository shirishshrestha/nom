import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ConfirmFileDto {
  @ApiProperty({ description: 'Vendor to link the confirmed file to.' })
  @IsUUID()
  vendorId!: string;
}
