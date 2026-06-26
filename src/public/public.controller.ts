import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';
import { PublicProposalDto } from './dto/public-proposal.dto';

// Unauthenticated. The shareToken IS the capability — no JWT. Still covered by the
// global rate limiter (abuse prevention).
@ApiTags('public')
@Controller('public/proposals')
export class PublicController {
  constructor(private publicSvc: PublicService) {}

  @Get(':token')
  @ApiOkResponse({ type: PublicProposalDto })
  get(@Param('token') token: string) {
    return this.publicSvc.getSharedProposal(token);
  }
}
