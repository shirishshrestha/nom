import { ApiProperty } from '@nestjs/swagger';

export class ApiResponse<T> {
  @ApiProperty() success = true;
  @ApiProperty() data: T | null;
  @ApiProperty() message: string;
  @ApiProperty() status: number;

  constructor(data: T, message = 'success', status = 200) {
    this.data = data;
    this.message = message;
    this.status = status;
  }
}
