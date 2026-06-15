import { IsIn } from 'class-validator';
export class CheckoutDto { @IsIn(['solo', 'pro', 'agency']) plan: 'solo' | 'pro' | 'agency'; }
