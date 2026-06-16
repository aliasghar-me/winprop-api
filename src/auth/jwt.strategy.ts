import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtUser {
  userId: string;
  orgId: string;
  role: string;
  preferredLanguage?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }
  async validate(payload: any): Promise<JwtUser> {
    return {
      userId: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
      preferredLanguage: payload.preferredLanguage,
    };
  }
}
