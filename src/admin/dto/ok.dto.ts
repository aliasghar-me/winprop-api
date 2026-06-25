import { ApiProperty } from '@nestjs/swagger';

export class OkDto {
  @ApiProperty() ok: boolean;
}
