import { useEffect } from 'react';

interface Props {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: string;
  /** Optional JSON-LD payload — e.g. Restaurant schema on the home page,
   *  MenuItem schema on the item detail page. Replaces any prior
   *  route-level JSON-LD on next mount; the index.html JSON-LD stays. */
  jsonLd?: Record<string, unknown>;
}

const ROUTE_JSONLD_ID = 'route-jsonld';

/**
 * SEO component — dynamically sets document title, meta tags,
 * Open Graph tags, Twitter cards, canonical link, and an optional
 * JSON-LD structured-data block on each page.
 *
 * NOTE: Social media crawlers don't execute JS, so these tags only work
 * for browser users. For crawlers, the API serves pre-rendered OG HTML
 * via /public/og/:branchId/menu/:slug endpoints.
 */
export default function SEO({ title, description, keywords, image, url, type = 'website', jsonLd }: Props) {
  useEffect(() => {
    if (title) document.title = title;

    const setMeta = (attr: 'name' | 'property', name: string, content: string | undefined) => {
      if (!content) return;
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    const setLink = (rel: string, href: string) => {
      let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', rel);
        document.head.appendChild(el);
      }
      el.setAttribute('href', href);
    };

    const pageUrl = url || window.location.href;
    // Resolve relative image URLs to absolute
    const absImage = image
      ? image.startsWith('http') ? image : `${window.location.origin}${image.startsWith('/') ? '' : '/'}${image}`
      : undefined;

    setMeta('name', 'description', description);
    setMeta('name', 'keywords', keywords);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:image', absImage);
    setMeta('property', 'og:url', pageUrl);
    setMeta('property', 'og:type', type);
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', absImage);

    // Canonical — every indexable URL needs one. Strips the hash and
    // search string for cleanliness; pages that need query-string
    // canonicals can pass `url` explicitly.
    const canonical = url || `${window.location.origin}${window.location.pathname}`;
    setLink('canonical', canonical);

    // Replace prior route-scoped JSON-LD (the index.html baseline stays).
    const prior = document.getElementById(ROUTE_JSONLD_ID);
    if (prior) prior.remove();
    if (jsonLd) {
      const tag = document.createElement('script');
      tag.id = ROUTE_JSONLD_ID;
      tag.type = 'application/ld+json';
      tag.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(tag);
    }
  }, [title, description, keywords, image, url, type, jsonLd]);

  return null;
}

/** Generate a URL-friendly slug from a name */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
