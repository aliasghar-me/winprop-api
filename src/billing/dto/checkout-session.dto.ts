import { ApiProperty } from '@nestjs/swagger';

export class CheckoutSessionDto {
  @ApiProperty({ type: String, nullable: true }) url: string | null;
}
