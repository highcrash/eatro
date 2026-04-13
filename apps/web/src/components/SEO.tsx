import { useEffect } from 'react';

interface Props {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: string;
}

/**
 * SEO component — dynamically sets document title, meta tags,
 * Open Graph tags, and Twitter cards on each page.
 *
 * NOTE: Social media crawlers don't execute JS, so these tags only work
 * for browser users. For crawlers, the API serves pre-rendered OG HTML
 * via /public/og/:branchId/menu/:slug endpoints.
 */
export default function SEO({ title, description, keywords, image, url, type = 'website' }: Props) {
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
  }, [title, description, keywords, image, url, type]);

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
