import { ApiProperty } from '@nestjs/swagger';

export class LanguageUpdatedDto {
  @ApiProperty() ok: boolean;
  @ApiProperty() language: string;
}
