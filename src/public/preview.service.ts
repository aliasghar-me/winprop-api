import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { AppException } from '../common/errors/app-exception';
import type { PreviewRequestDto } from './dto/preview-request.dto';

@Injectable()
export class PreviewService {
  constructor(private llm: LlmService) {}

  async preview(dto: PreviewRequestDto) {
    // Honeypot: a human never fills `website` (it is visually hidden). Reject as a
    // generic bad request so scrapers can't distinguish it from normal validation.
    if (dto.website && dto.website.trim().length > 0) {
      throw new AppException(400, 'VALIDATION', 'errors.badRequest');
    }
    return this.llm.generatePreview(dto.title, dto.description);
  }
}
