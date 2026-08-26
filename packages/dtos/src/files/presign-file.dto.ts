import { OmitType } from '@nestjs/swagger';
import { CreateFileDto } from './create-file.dto';

export class PresignFileDto extends OmitType(CreateFileDto, [
  'storageKey',
] as const) {}
