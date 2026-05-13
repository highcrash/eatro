import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SmsBlastSegmentDto {
  @ApiProperty({ required: false, description: 'Lifetime spend ≥ X TAKA (whole units, not paisa).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSpent?: number;

  @ApiProperty({ required: false, description: 'Total paid order count ≥ X.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minVisits?: number;

  @ApiProperty({ required: false, description: 'Visited within the last N days.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxLastVisitDays?: number;

  @ApiProperty({ required: false, description: 'Loyalty point balance ≥ X.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minLoyaltyPoints?: number;
}

export class SmsBlastDto {
  @ApiProperty({ type: SmsBlastSegmentDto, description: 'Segment filter. Empty object = all active customers with a phone.' })
  @ValidateNested()
  @Type(() => SmsBlastSegmentDto)
  segment!: SmsBlastSegmentDto;

  @ApiProperty({
    description:
      "SMS template body. Supports placeholders: {{name}}, {{phone}}, {{brand}}, {{pointsBalance}}. {{name}} falls back to 'Dear Customer'.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  smsTemplate!: string;

  @ApiProperty({
    required: false,
    description:
      "Free-form grouping tag persisted alongside the sends (SmsLog.campaignId). Use the same tag across a batch so you can aggregate later.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignTag?: string;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'When true, only resolves the recipient list and returns the count. No SMS is sent and no log rows are written. Use this to preview before committing.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
