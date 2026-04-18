import { IsString, IsNotEmpty, MaxLength, MinLength, Matches } from 'class-validator';

/** Domain pattern: hostname-y. No path, no scheme. Lowercase enforced
 *  by service code; we just guard against obvious garbage at the edge. */
const DOMAIN_RE = /^(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*$/;

export class ActivateDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  productSku!: string;

  // CodeCanyon purchase codes are 36 hex chars; we tolerate a wider
  // range (anything alphanumeric+dashes 8-128 chars) so manual / GRANT
  // codes the admin issues from the dashboard work too.
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'purchaseCode must be alphanumeric/dashes only' })
  purchaseCode!: string;

  @IsString() @IsNotEmpty() @MaxLength(253)
  @Matches(DOMAIN_RE, { message: 'domain must be a valid hostname (no path, no scheme)' })
  domain!: string;

  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  fingerprint!: string;
}

export class VerifyDto {
  @IsString() @IsNotEmpty() @MaxLength(40)
  licenseId!: string;

  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  fingerprint!: string;
}

export class DeactivateDto {
  @IsString() @IsNotEmpty() @MaxLength(40)
  licenseId!: string;

  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  fingerprint!: string;
}
