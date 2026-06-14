import { IsOptional, IsString, MinLength } from 'class-validator';
export class CreateJobDto {
  @IsString() @MinLength(1) title: string;
  @IsOptional() @IsString() company?: string;
}
