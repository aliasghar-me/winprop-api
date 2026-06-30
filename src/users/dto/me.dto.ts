import { ApiProperty } from '@nestjs/swagger';

export class MeDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty() emailVerified: boolean;
}
