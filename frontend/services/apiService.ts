import { ProcessedFace, AnalysisResponse, EmotionData } from '../types';

const API_ENDPOINT = import.meta.env.VITE_BACKEND_URL;

async function resizeImageFileToJpegBlob(file: Blob, width = 128, height = 128, quality = 0.8): Promise<Blob | null> {
  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imageBitmap, 0, 0, width, height);
  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Returns a client-friendly object:
 * {
 *   images: any[], // raw per-image results from backend
 *   top3_aggregate: EmotionData[], // mapped to {label, score}
 *   gemini_feedback: string,
 *   timings: any
 * }
 */
export async function analyzeFaces(faces: ProcessedFace[], context: string): Promise<{
  images: any[];
  top3_aggregate: EmotionData[];
  gemini_feedback: string;
  timings: any;
}> {
  if (!faces || faces.length === 0) {
    throw new Error('No faces to analyze (faces array is empty).');
  }

  // yield one frame so UI can repaint (toggle animation etc.)
  await new Promise((r) => requestAnimationFrame(() => r(undefined)));

  const formData = new FormData();
  const commonFormat = faces[0]?.blob?.type ?? 'image/jpeg';

  const metadata = {
    timestamp: new Date().toISOString(),
    batch_index: 0,
    source: 'EmoTutor-overlay-v1',
    face_count: faces.length,
    faces_meta: faces.map((f) => f.metadata),
    image_format: commonFormat,
    image_size_px: [128, 128],
  };

  formData.append('metadata', JSON.stringify(metadata));
  formData.append('context', context);

  for (let i = 0; i < faces.length; ++i) {
    try {
      const resized = await resizeImageFileToJpegBlob(faces[i].blob, 128, 128, 0.8);
      if (!resized) throw new Error('Failed to resize image');
      formData.append('files', resized, `face_${i}.jpg`);
    } catch (err) {
      console.warn('Image resize failed at index', i, err);
      formData.append('files', faces[i].blob, `face_${i}.jpg`);
    }
    if (i % 2 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  try {
    console.log('FormData entries:');
    for (const [k, v] of (formData as any).entries()) {
      console.log(k, v instanceof File ? v.name : v);
    }
  } catch (e) {
    console.warn('Unable to enumerate FormData entries', e);
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    console.log(`Attempting to connect to: ${API_ENDPOINT}`);
    response = await fetch(API_ENDPOINT, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log(`Response received: ${response.status} ${response.statusText}`);
  } catch (error: any) {
    console.error('Fetch error details:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });

    if (error.name === 'AbortError') {
      throw new Error(`Request timeout: Server at ${API_ENDPOINT} did not respond within 30 seconds.`);
    }

    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      const troubleshooting = `
Unable to reach server at ${API_ENDPOINT}
Possible causes:
1. Backend service is not running on the EC2 instance
2. Backend service is running on a different port (not 80)
3. EC2 instance firewall is blocking connections
4. CORS configuration issue (check server logs)

To troubleshoot:
- SSH into your EC2 instance and check if the service is running
- Verify the service is listening on port 80: sudo ss -ltnp | grep :80
- Check service logs for errors
- Test from EC2: curl http://localhost/analyze`;
      throw new Error(troubleshooting);
    }

    throw new Error(`Failed to upload: ${error.message || 'Unknown network error'}`);
  }

  // Parse JSON once
  let raw: AnalysisResponse;
  try {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Server returned non-JSON response: ${text.substring(0, 200)}`);
    }
    raw = (await response.json()) as AnalysisResponse;
  } catch (err: any) {
    if (err.message && err.message.includes('non-JSON')) throw err;
    throw new Error(`Failed to parse server response (Status: ${response.status}). The server may be experiencing issues.`);
  }

  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`;
    if ((raw as any)?.detail) {
      const detail = (raw as any).detail;
      errorMessage = Array.isArray(detail) ? detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ') : detail;
    } else if ((raw as any)?.message) {
      errorMessage = (raw as any).message;
    }
    throw new Error(errorMessage);
  }

  // Map backend emotions (confidence -> score) for UI
  const mappedTop3: EmotionData[] = (raw.top3_aggregate || []).map((e: any) => ({
    label: e.label,
    score: typeof e.confidence === 'number' ? e.confidence : 0,
  }));

  return {
    images: raw.images,
    top3_aggregate: mappedTop3,
    gemini_feedback: raw.gemini_feedback,
    timings: raw.timings,
  };
}
