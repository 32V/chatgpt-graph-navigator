/**
 * Converts structured ChatGPT message content into readable graph text.
 */

import { log } from '../../shared/utils.js';

function processImage(part) {
  const pointer = part.asset_pointer || '';
  const title = part.metadata?.dalle?.prompt ||
    part.metadata?.generation?.serialization_title ||
    part.metadata?.image_gen_title ||
    'Image';
  const width = part.width || part.metadata?.container_pixel_width;
  const height = part.height || part.metadata?.container_pixel_height;
  const sizeInfo = width && height ? ` (${width}x${height})` : '';
  return `[Image: ${title}${sizeInfo}](${pointer})`;
}

function processPart(part) {
  if (!part) return '';
  if (typeof part === 'string') return part;
  if (Array.isArray(part)) return part.map(processPart).filter(Boolean).join('');
  if (typeof part !== 'object') return '';

  if (part.content_type === 'image_asset_pointer') {
    try {
      return processImage(part);
    } catch (error) {
      log('warn', 'ContentProcessor', 'Failed to process image content:', error);
      return '';
    }
  }

  if (typeof part.text === 'string') return part.text;
  if (Array.isArray(part.parts)) return part.parts.map(processPart).filter(Boolean).join('');
  return '';
}

export function processContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(processPart).filter(Boolean).join('');

  if (typeof content === 'object') {
    if (Array.isArray(content.parts)) {
      return content.parts.map(processPart).filter(Boolean).join('\n');
    }
    if (typeof content.text === 'string') return content.text;
  }

  return '';
}

export function hasValidContent(content) {
  return processContent(content).trim().length > 0;
}
