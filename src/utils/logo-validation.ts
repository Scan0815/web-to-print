import ExifReader from 'exifreader';
import { LogoFormat, LogoMetadata, LogoValidationConfig, LogoValidationIssue, LogoValidationResult, DEFAULT_VALIDATION_CONFIG } from '../types';
import { detectFileFormat, isSvgContent } from './format-detection';

function createIssue(code: string, severity: 'error' | 'warning', message: string): LogoValidationIssue {
  return { code, severity, message };
}

async function extractDpi(file: File, format: LogoFormat): Promise<{ dpiX: number | null; dpiY: number | null }> {
  if (format !== 'jpeg' && format !== 'tiff' && format !== 'png' && format !== 'avif') {
    return { dpiX: null, dpiY: null };
  }

  try {
    const buffer = await file.arrayBuffer();
    const tags = ExifReader.load(buffer, { expanded: true });

    // Try EXIF XResolution/YResolution
    const xRes = tags.exif?.XResolution?.value;
    const yRes = tags.exif?.YResolution?.value;
    if (xRes !== undefined && xRes !== null && yRes !== undefined && yRes !== null) {
      const dpiX = Array.isArray(xRes) ? xRes[0] / xRes[1] : Number(xRes);
      const dpiY = Array.isArray(yRes) ? yRes[0] / yRes[1] : Number(yRes);
      return { dpiX, dpiY };
    }

    // PNG pHYs chunk: pixels per metre -> DPI. ExifReader files it under the `png` group.
    if (format === 'png') {
      const png = (tags as { png?: Record<string, { value: number | string } | undefined> }).png;
      const pngX = png?.['Pixels Per Unit X']?.value;
      const pngY = png?.['Pixels Per Unit Y']?.value;
      const unit = png?.['Pixel Units']?.value;
      if (pngX !== undefined && pngY !== undefined && unit === 1) {
        return { dpiX: Math.round(Number(pngX) / 39.3701), dpiY: Math.round(Number(pngY) / 39.3701) };
      }
    }

    return { dpiX: null, dpiY: null };
  } catch {
    return { dpiX: null, dpiY: null };
  }
}

async function extractImageDimensions(file: File, format: LogoFormat): Promise<{ width: number; height: number }> {
  // PDF/AI dimensions come from rasterizing page 1 in the upload component. Running
  // ExifReader and an <img> load over a multi-MB PDF here only wastes two full reads.
  if (format === 'pdf' || format === 'ai') return { width: 0, height: 0 };

  if (format === 'svg') {
    const text = await file.text();
    const match = text.match(/viewBox=["'](\d+[\s,]+\d+[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?))["']/);
    if (match !== null) {
      return { width: Math.round(parseFloat(match[2])), height: Math.round(parseFloat(match[3])) };
    }
    const widthMatch = text.match(/width=["'](\d+(?:\.\d+)?)(?:px)?["']/);
    const heightMatch = text.match(/height=["'](\d+(?:\.\d+)?)(?:px)?["']/);
    return {
      width: widthMatch !== null ? Math.round(parseFloat(widthMatch[1])) : 0,
      height: heightMatch !== null ? Math.round(parseFloat(heightMatch[1])) : 0,
    };
  }

  // For raster images, try to extract dimensions from EXIF/file header
  try {
    const buffer = await file.arrayBuffer();
    const tags = ExifReader.load(buffer, { expanded: true });
    const exifWidth = tags.file?.['Image Width']?.value ?? tags.exif?.ImageWidth?.value ?? tags.exif?.PixelXDimension?.value;
    const exifHeight = tags.file?.['Image Height']?.value ?? tags.exif?.ImageLength?.value ?? tags.exif?.PixelYDimension?.value;
    if (exifWidth !== undefined && exifWidth !== null && exifHeight !== undefined && exifHeight !== null) {
      return { width: Number(exifWidth), height: Number(exifHeight) };
    }
  } catch {
    // Fall through
  }

  // Fallback: use Image element if available (browser environment)
  if (typeof globalThis.Image !== 'undefined') {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new globalThis.Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      img.src = url;
    });
  }

  return { width: 0, height: 0 };
}

export async function validateLogo(
  file: File,
  config: LogoValidationConfig = DEFAULT_VALIDATION_CONFIG,
): Promise<LogoValidationResult> {
  const issues: LogoValidationIssue[] = [];
  const format = await detectFileFormat(file);

  // Format check
  if (!config.allowedFormats.includes(format)) {
    issues.push(createIssue('FORMAT_NOT_ALLOWED', 'error', `Format "${format}" is not allowed. Allowed: ${config.allowedFormats.join(', ')}`));
  }

  // File size check
  if (file.size > config.maxFileSize) {
    const maxMb = Math.round(config.maxFileSize / (1024 * 1024));
    issues.push(createIssue('FILE_TOO_LARGE', 'error', `File size exceeds ${maxMb}MB limit`));
  }

  // SVG content validation
  if (format === 'svg') {
    const text = await file.text();
    if (!isSvgContent(text)) {
      issues.push(createIssue('INVALID_SVG', 'error', 'File does not contain valid SVG content'));
    }
  }

  // Extract metadata
  const { dpiX, dpiY } = await extractDpi(file, format);
  const { width, height } = await extractImageDimensions(file, format);

  // The DPI tag is read for the metadata but not judged: it says nothing about print
  // quality (a 200 px logo tagged 300 DPI is still blurry at 50 mm, a 4000 px one tagged
  // 72 is fine). Resolution is checked where the print size is known — in the editor,
  // see validateDecoration.
  const isRaster = format === 'png' || format === 'jpeg' || format === 'tiff' || format === 'avif';

  // Dimension check for raster images only (vector formats like SVG/PDF are resolution-independent)
  if (isRaster) {
    if (width > 0 && width < config.minWidth) {
      issues.push(createIssue('WIDTH_TOO_SMALL', 'error', `Image width (${width}px) is below minimum ${config.minWidth}px`));
    }
    if (height > 0 && height < config.minHeight) {
      issues.push(createIssue('HEIGHT_TOO_SMALL', 'error', `Image height (${height}px) is below minimum ${config.minHeight}px`));
    }
  }

  const metadata: LogoMetadata = {
    format,
    width,
    height,
    dpiX,
    dpiY,
    fileSize: file.size,
    fileName: file.name,
    mimeType: file.type,
    hasTransparency: format === 'png' || format === 'svg' || format === 'avif',
  };

  return {
    valid: !issues.some(i => i.severity === 'error'),
    metadata,
    issues,
  };
}
