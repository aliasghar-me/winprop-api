import { ApiProperty } from '@nestjs/swagger';

export class PreviewSectionDto {
  @ApiProperty() heading: string;
  @ApiProperty() body: string;
}

export class PreviewResultDto {
  @ApiProperty({ type: [PreviewSectionDto] }) sections: PreviewSectionDto[];
  @ApiProperty({ type: [String] }) lockedTitles: string[];
}
