import { IsString, IsNotEmpty, MaxLength, MinLength, Matches } from 'class-validator';

/**
 * Domain pattern at the edge. Two accepted shapes:
 *   - Plain hostname:  example.com        (matches exactly after www-strip)
 *   - Wildcard prefix: *.example.com      (matches any sub-depth + bare root)
 *
 * Nested wildcards (*.sub.*.foo.com) are rejected — they add complexity
 * without a real use case. Service code normalises + the client-side
 * matcher (domain-match.ts) does the runtime check.
 *
 * No path, no scheme. Lowercase enforced downstream.
 */
const DOMAIN_RE = /^(\*\.)?(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})*$/;

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
