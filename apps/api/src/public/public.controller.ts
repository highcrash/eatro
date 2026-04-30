import { Controller, Get, Param, Query, Res, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PublicService } from './public.service';

@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('table/:tableId')
  getTableInfo(@Param('tableId') tableId: string) {
    return this.publicService.getTableInfo(tableId);
  }

  @Get('branches')
  getBranches() {
    return this.publicService.getBranches();
  }

  @Get('menu/:branchId/discounted')
  getDiscounted(@Param('branchId') branchId: string) {
    return this.publicService.getDiscountedItems(branchId);
  }

  @Get('menu/:branchId/recommended')
  getRecommended(@Param('branchId') branchId: string, @Query('categoryId') categoryId?: string) {
    return this.publicService.getRecommended(branchId, categoryId);
  }

  @Get('menu/:branchId/item/:itemId')
  getMenuItem(@Param('branchId') branchId: string, @Param('itemId') itemId: string) {
    return this.publicService.getMenuItem(branchId, itemId);
  }

  @Get('menu/:branchId')
  getMenu(@Param('branchId') branchId: string) {
    return this.publicService.getMenu(branchId);
  }

  /**
   * Print-friendly menu — same visibility filters as `/menu/:branchId`
   * plus per-item `keyIngredients[]` (capped at 5, filtered by
   * `Ingredient.showOnWebsite`, `websiteDisplayName` aliased). Drives
   * the website's `/menu-print` A4 hardcopy page.
   */
  @Get('menu-print/:branchId')
  getMenuForPrint(@Param('branchId') branchId: string) {
    return this.publicService.getMenuForPrint(branchId);
  }

  @Get('reviews/:branchId')
  getReviews(@Param('branchId') branchId: string) {
    return this.publicService.getReviews(branchId);
  }

  /**
   * Public-safe slice of BranchSetting for the QR app — exposes only
   * the toggles the customer-facing UI needs (whether self-service
   * ingredient removal is allowed). No staff data, no SMS keys, no
   * money policy fields leak.
   */
  @Get('branch/:branchId/settings')
  getBranchPublicSettings(@Param('branchId') branchId: string) {
    return this.publicService.getPublicBranchSettings(branchId);
  }

  /**
   * Recipe ingredients for a single menu item — used by the QR app's
   * "Customise ingredients" picker when the branch has the
   * qrAllowSelfRemoveIngredients toggle ON. Returns ONLY ingredient
   * id + name (no quantities, no costs, no supplier info).
   */
  @Get('menu/recipe/:menuItemId')
  getPublicRecipe(@Param('menuItemId') menuItemId: string) {
    return this.publicService.getPublicRecipe(menuItemId);
  }

  /**
   * OG Meta Tags endpoint — returns HTML with Open Graph tags for social media crawlers.
   * Usage: Configure your static site hosting to proxy /og/* to this endpoint,
   * or use this as a fallback for crawlers that don't execute JavaScript.
   *
   * GET /public/og/:branchId/menu/:itemSlug — OG tags for a menu item
   * GET /public/og/:branchId — OG tags for homepage
   */
  @Get('og/:branchId/menu/:itemSlug')
  @Header('Content-Type', 'text/html')
  async getMenuItemOG(
    @Param('branchId') branchId: string,
    @Param('itemSlug') itemSlug: string,
    @Res() res: Response,
  ) {
    const item = await this.publicService.getMenuItem(branchId, itemSlug);
    const branch = await this.publicService.getBranchById(branchId);
    const siteName = branch?.name ?? 'EATRO';
    const siteUrl = 'https://eatrobd.com';

    if (!item) {
      res.status(404).send('<html><head><title>Not Found</title></head><body>Not Found</body></html>');
      return;
    }

    const title = (item as any).seoTitle || `${siteName} — ${item.name}`;
    const description = (item as any).seoDescription || item.description || `${item.name} at ${siteName}`;
    const image = item.imageUrl || '';
    const url = `${siteUrl}/menu/${(item as any).slug || item.id}`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${this.escHtml(title)}</title>
  <meta name="description" content="${this.escHtml(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${this.escHtml(siteName)}" />
  <meta property="og:title" content="${this.escHtml(title)}" />
  <meta property="og:description" content="${this.escHtml(description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${image}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${this.escHtml(title)}" />
  <meta name="twitter:description" content="${this.escHtml(description)}" />
  <meta name="twitter:image" content="${image}" />
  <meta http-equiv="refresh" content="0;url=${url}" />
</head>
<body><p>Redirecting to <a href="${url}">${this.escHtml(title)}</a></p></body>
</html>`;
    res.send(html);
  }

  @Get('og/:branchId')
  @Header('Content-Type', 'text/html')
  async getHomepageOG(@Param('branchId') branchId: string, @Res() res: Response) {
    const branch = await this.publicService.getBranchById(branchId);
    const siteName = branch?.name ?? 'EATRO';
    const siteUrl = 'https://eatrobd.com';
    const logo = (branch as any)?.logoUrl || '';

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${this.escHtml(siteName)} — Where Flavor Takes The Lead</title>
  <meta name="description" content="Fine dining restaurant with fusion cuisine." />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${this.escHtml(siteName)}" />
  <meta property="og:title" content="${this.escHtml(siteName)} — Where Flavor Takes The Lead" />
  <meta property="og:description" content="Fine dining restaurant with fusion cuisine. View our menu, book a table." />
  <meta property="og:url" content="${siteUrl}" />
  <meta property="og:image" content="${logo}" />
  <meta property="og:logo" content="${logo}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${this.escHtml(siteName)}" />
  <meta name="twitter:image" content="${logo}" />
  <meta http-equiv="refresh" content="0;url=${siteUrl}" />
</head>
<body><p>Redirecting to <a href="${siteUrl}">${this.escHtml(siteName)}</a></p></body>
</html>`;
    res.send(html);
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
