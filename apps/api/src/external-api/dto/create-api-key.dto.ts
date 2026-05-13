import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { API_SCOPES, type ApiScope } from './api-scope.const';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Marketing AI - Production', maxLength: 80 })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    description: 'Scopes the key may use. Must be a non-empty subset of supported scopes.',
    enum: API_SCOPES,
    isArray: true,
    example: ['business:read', 'reports:read', 'customers:read'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(API_SCOPES as readonly string[], { each: true })
  scopes!: ApiScope[];

  @ApiProperty({
    description: 'Optional absolute expiry in ISO 8601. Omit for no expiry.',
    required: false,
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
