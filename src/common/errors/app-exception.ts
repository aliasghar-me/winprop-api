import { HttpException } from '@nestjs/common';

export type AppErrorCode =
  | 'DUPLICATE_NAME' | 'QUOTA_EXCEEDED' | 'SUBSCRIPTION_INACTIVE'
  | 'LLM_NOT_CONFIGURED' | 'LLM_PROVIDER_ERROR'
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION';

export class AppException extends HttpException {
  constructor(statusCode: number, public code: AppErrorCode, message: string) {
    super({ statusCode, code, message }, statusCode);
  }
}
