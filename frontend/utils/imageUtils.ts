
export async function cropResizeToBlob(
  source: ImageBitmapSource,
  bbox: { x: number; y: number; w: number; h: number },
  opts: Partial<{
    targetSize: number;
    maxBytes: number;
    qualityStart: number;
    qualityStep: number;
    minQuality: number;
    webpFallback: boolean;
  }> = {}
) {
  const {
    targetSize = 128,
    maxBytes = 300 * 1024,
    qualityStart = 0.9,
    qualityStep = 0.08,
    minQuality = 0.25,
    webpFallback = true
  } = opts;

  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(targetSize, targetSize)
    : document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not get canvas context");

  // FIX: To handle all ImageBitmapSource types, convert the source to an ImageBitmap.
  // This ensures that types like Blob or ImageData can be drawn on the canvas,
  // resolving the "Argument of type 'ImageBitmapSource' is not assignable to parameter of type 'CanvasImageSource'" error.
  const imageBitmap = await createImageBitmap(source);

  let { x, y, w, h } = bbox;
  const size = Math.max(w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  x = Math.round(cx - size / 2);
  y = Math.round(cy - size / 2);
  w = h = size;

  // FIX: Cast context to CanvasRenderingContext2D to resolve type ambiguity.
  // The API for drawing is compatible between CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
  const drawCtx = ctx as CanvasRenderingContext2D;
  drawCtx.clearRect(0, 0, targetSize, targetSize);
  drawCtx.drawImage(imageBitmap, x, y, w, h, 0, 0, targetSize, targetSize);

  // FIX: Refactored to correctly handle OffscreenCanvas and HTMLCanvasElement separately
  const canvasToBlob = (type: string, quality: number): Promise<Blob> => {
    if (canvas instanceof OffscreenCanvas) {
      return canvas.convertToBlob({ type, quality });
    }
    return new Promise((res, rej) => {
      canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob failed")), type, quality);
    });
  };

  let quality = qualityStart;
  let blob: Blob;

  // Try JPEG first
  blob = await canvasToBlob("image/jpeg", quality);

  while (blob.size > maxBytes && quality > minQuality) {
    quality = Math.max(minQuality, quality - qualityStep);
    blob = await canvasToBlob("image/jpeg", quality);
  }

  let format = "image/jpeg";

  // WebP Fallback
  if (blob.size > maxBytes && webpFallback) {
    try {
      let wQuality = 0.9;
      let webpBlob = await canvasToBlob("image/webp", wQuality);
      while (webpBlob.size > maxBytes && wQuality > 0.25) {
        wQuality = Math.max(0.25, wQuality - 0.12);
        webpBlob = await canvasToBlob("image/webp", wQuality);
      }
      if (webpBlob.size <= maxBytes) {
        blob = webpBlob;
        format = "image/webp";
      }
    } catch (e) {
      console.warn("WebP conversion failed", e);
    }
  }

  if (blob.size > maxBytes) {
    throw new Error(`Unable to compress under ${maxBytes / 1024} KB`);
  }

  return { blob, format, width: targetSize, height: targetSize, sizeBytes: blob.size };
}