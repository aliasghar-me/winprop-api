import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { PreviewService } from './preview.service';
import { PublicProposalDto } from './dto/public-proposal.dto';
import { PreviewRequestDto } from './dto/preview-request.dto';
import { PreviewResultDto } from './dto/preview-result.dto';

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

  // Anonymous funnel teaser. Tight per-IP limit (2 / 24h) on top of the global limiter.
  @Post('preview')
  @Throttle({ default: { limit: 2, ttl: 86_400_000 } })
  @ApiOkResponse({ type: PreviewResultDto })
  preview(@Body() dto: PreviewRequestDto) {
    return this.previewSvc.preview(dto);
  }
}
