import { IsEnum, IsString } from 'class-validator';
import { LlmVendor } from '@prisma/client';
export class SetLlmDto {
  @IsEnum(LlmVendor) provider: LlmVendor;
  @IsString() model: string;
  @IsString() apiKey: string;
}
