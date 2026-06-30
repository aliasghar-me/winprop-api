import { HttpException } from '@nestjs/common';

export type AppErrorCode =
  | 'DUPLICATE_NAME' | 'QUOTA_EXCEEDED' | 'SUBSCRIPTION_INACTIVE'
  | 'LLM_NOT_CONFIGURED' | 'LLM_PROVIDER_ERROR'
  | 'EMAIL_NOT_VERIFIED' | 'INVALID_TOKEN'
  | 'MFA_REQUIRED' | 'MFA_INVALID'
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION';

export class AppException extends HttpException {
  constructor(
    statusCode: number,
    public code: AppErrorCode,
    public translationKey: string,
    public args?: Record<string, any>,
  ) {
    super({ statusCode, code, translationKey, args }, statusCode);
  }
}
