import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { PreviewService } from './preview.service';
import { PublicProposalDto } from './dto/public-proposal.dto';
import { PreviewRequestDto } from './dto/preview-request.dto';
import { PreviewResultDto } from './dto/preview-result.dto';

// Per-IP rate limit for the anonymous funnel preview. This is an anti-abuse /
// anti-scraping guard only — the real cost backstop is the daily anon USD cap
// (LLM_ANON_DAILY_USD_CAP) in LlmService. Kept generous enough that a genuine
// visitor iterating on their pitch (or a few people behind one office IP/NAT)
// never hits it, while a scraper hammering the endpoint still does.
export const PREVIEW_THROTTLE = { limit: 20, ttl: 3_600_000 }; // 20 / hour / IP

// Unauthenticated. The shareToken IS the capability — no JWT. Still covered by the
// global rate limiter (abuse prevention).
@ApiTags('public')
@Controller('public/proposals')
export class PublicController {
  constructor(private publicSvc: PublicService, private previewSvc: PreviewService) {}

  @Get(':token')
  @ApiOkResponse({ type: PublicProposalDto })
  get(@Param('token') token: string) {
    return this.publicSvc.getSharedProposal(token);
  }

  // Anonymous funnel teaser. Per-IP limit (see PREVIEW_THROTTLE) on top of the global limiter.
  @Post('preview')
  @HttpCode(200)
  @Throttle({ default: PREVIEW_THROTTLE })
  @ApiOkResponse({ type: PreviewResultDto })
  preview(@Body() dto: PreviewRequestDto) {
    return this.previewSvc.preview(dto);
  }
}
