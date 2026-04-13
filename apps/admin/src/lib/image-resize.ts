/**
 * Resize an image file before upload — preserves aspect ratio, no cropping.
 * Outputs as WebP for smaller file size (falls back to JPEG).
 */

interface ResizeOptions {
  maxWidth: number;
  maxHeight: number;
  quality?: number; // 0-1, default 0.85
}

/** Predefined size presets for different use cases */
export const IMAGE_PRESETS = {
  /** Hero backgrounds, banners, section backgrounds — full width */
  hero: { maxWidth: 1920, maxHeight: 1080, quality: 0.85 },
  /** Gallery images — medium */
  gallery: { maxWidth: 1200, maxHeight: 900, quality: 0.82 },
  /** Menu item photos — square-ish, medium */
  menuItem: { maxWidth: 800, maxHeight: 800, quality: 0.85 },
  /** Logo — small, high quality */
  logo: { maxWidth: 400, maxHeight: 200, quality: 0.9 },
  /** OG image / social sharing */
  ogImage: { maxWidth: 1200, maxHeight: 630, quality: 0.85 },
  /** Favicon */
  favicon: { maxWidth: 192, maxHeight: 192, quality: 0.9 },
  /** Ingredient image — small square */
  ingredient: { maxWidth: 300, maxHeight: 300, quality: 0.85 },
  /** About section image */
  about: { maxWidth: 1200, maxHeight: 900, quality: 0.85 },
} as const;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

/**
 * Resize an image File, preserving aspect ratio.
 * Returns a new File ready for upload.
 */
export async function resizeImage(file: File, preset: ImagePreset | ResizeOptions): Promise<File> {
  const opts = typeof preset === 'string' ? IMAGE_PRESETS[preset] : preset;
  const { maxWidth, maxHeight, quality = 0.85 } = opts;

  // Skip if not an image
  if (!file.type.startsWith('image/')) return file;

  // Skip SVGs
  if (file.type === 'image/svg+xml') return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Skip if already within bounds
      if (width <= maxWidth && height <= maxHeight) {
        resolve(file);
        return;
      }

      // Calculate new dimensions preserving aspect ratio
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);

      // Draw to canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      const outputType = canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
      const ext = outputType === 'image/webp' ? '.webp' : '.jpg';

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const resized = new File([blob], file.name.replace(/\.[^.]+$/, ext), { type: outputType });
          resolve(resized);
        },
        outputType,
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // fallback to original on error
    };

    img.src = url;
  });
}
