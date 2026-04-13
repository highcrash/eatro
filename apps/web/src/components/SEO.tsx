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
 * SEO component — dynamically sets document title, meta description,
 * Open Graph tags, and Twitter cards. Call on each page.
 */
export default function SEO({ title, description, keywords, image, url, type = 'website' }: Props) {
  useEffect(() => {
    if (title) document.title = title;

    const setMeta = (name: string, content: string | undefined) => {
      if (!content) return;
      let el = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
      if (!el) {
        el = document.createElement('meta');
        const attr = name.startsWith('og:') || name.startsWith('twitter:') ? 'property' : 'name';
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    setMeta('description', description);
    setMeta('keywords', keywords);
    setMeta('og:title', title);
    setMeta('og:description', description);
    setMeta('og:image', image);
    setMeta('og:url', url || window.location.href);
    setMeta('og:type', type);
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);
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
