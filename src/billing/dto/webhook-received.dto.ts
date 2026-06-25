import { ApiProperty } from '@nestjs/swagger';

export class WebhookReceivedDto {
  @ApiProperty() received: boolean;
}
