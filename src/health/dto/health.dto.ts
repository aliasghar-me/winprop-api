import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty() status: string;
}
