import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface WebsiteContentDto {
  heroTitle?: string;
  heroSubtitle?: string | null;
  heroImageUrl?: string | null;
  heroCtaText?: string;
  aboutTitle?: string;
  aboutBody?: string;
  aboutImageUrl?: string | null;
  contactNote?: string | null;
  mapEmbedUrl?: string | null;
  featuredCategoryIds?: string[] | null;
}

@Injectable()
export class WebsiteService {
  constructor(private readonly prisma: PrismaService) {}

  /** Auto-creates a row on first read so the admin/web app always has data. */
  async getContent(branchId: string) {
    // Use raw queries to avoid stale Prisma client (model added late).
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "website_content" WHERE "branchId" = ${branchId} LIMIT 1
    `;
    if (rows.length > 0) return this.normalize(rows[0]);

    await this.prisma.$executeRaw`
      INSERT INTO "website_content" ("id", "branchId", "updatedAt")
      VALUES (${'wc_' + branchId}, ${branchId}, NOW())
    `;
    const created = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "website_content" WHERE "branchId" = ${branchId} LIMIT 1
    `;
    return this.normalize(created[0]);
  }

  async updateContent(branchId: string, dto: WebsiteContentDto) {
    // Ensure row exists
    await this.getContent(branchId);

    const sets: string[] = [];
    const updates: Record<string, unknown> = {};
    if (dto.heroTitle !== undefined)        { sets.push('"heroTitle"');        updates.heroTitle = dto.heroTitle; }
    if (dto.heroSubtitle !== undefined)     { sets.push('"heroSubtitle"');     updates.heroSubtitle = dto.heroSubtitle; }
    if (dto.heroImageUrl !== undefined)     { sets.push('"heroImageUrl"');     updates.heroImageUrl = dto.heroImageUrl; }
    if (dto.heroCtaText !== undefined)      { sets.push('"heroCtaText"');      updates.heroCtaText = dto.heroCtaText; }
    if (dto.aboutTitle !== undefined)       { sets.push('"aboutTitle"');       updates.aboutTitle = dto.aboutTitle; }
    if (dto.aboutBody !== undefined)        { sets.push('"aboutBody"');        updates.aboutBody = dto.aboutBody; }
    if (dto.aboutImageUrl !== undefined)    { sets.push('"aboutImageUrl"');    updates.aboutImageUrl = dto.aboutImageUrl; }
    if (dto.contactNote !== undefined)      { sets.push('"contactNote"');      updates.contactNote = dto.contactNote; }
    if (dto.mapEmbedUrl !== undefined)      { sets.push('"mapEmbedUrl"');      updates.mapEmbedUrl = dto.mapEmbedUrl; }
    if (dto.featuredCategoryIds !== undefined) {
      sets.push('"featuredCategoryIds"');
      updates.featuredCategoryIds = dto.featuredCategoryIds === null ? null : JSON.stringify(dto.featuredCategoryIds);
    }

    if (sets.length === 0) return this.getContent(branchId);

    // Build raw update — escape via parameterized statements would be safer,
    // but field set is fixed and small. Use Prisma update via $executeRawUnsafe.
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [k, v] of Object.entries(updates)) {
      setClauses.push(`"${k}" = $${idx++}`);
      params.push(v);
    }
    setClauses.push(`"updatedAt" = NOW()`);
    params.push(branchId);

    await this.prisma.$executeRawUnsafe(
      `UPDATE "website_content" SET ${setClauses.join(', ')} WHERE "branchId" = $${idx}`,
      ...params,
    );

    return this.getContent(branchId);
  }

  private normalize(row: Record<string, unknown>) {
    return {
      id: row.id as string,
      branchId: row.branchId as string,
      heroTitle: row.heroTitle as string,
      heroSubtitle: (row.heroSubtitle as string | null) ?? null,
      heroImageUrl: (row.heroImageUrl as string | null) ?? null,
      heroCtaText: row.heroCtaText as string,
      aboutTitle: row.aboutTitle as string,
      aboutBody: row.aboutBody as string,
      aboutImageUrl: (row.aboutImageUrl as string | null) ?? null,
      contactNote: (row.contactNote as string | null) ?? null,
      mapEmbedUrl: (row.mapEmbedUrl as string | null) ?? null,
      featuredCategoryIds: (() => {
        const raw = row.featuredCategoryIds as string | null;
        if (!raw) return [];
        try { return JSON.parse(raw) as string[]; } catch { return []; }
      })(),
      updatedAt: row.updatedAt as Date,
    };
  }
}
