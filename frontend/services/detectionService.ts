import { BoundingBox } from '../types';

// Declaration for ONNX Runtime Web, which is loaded via CDN
declare const ort: any;

// The model is now loaded from the local /public directory for reliability.
const MODEL_URL = '/yolov8n-face.onnx';
const MODEL_INPUT_SHAPE = [1, 3, 640, 640]; // NCHW
const STRIDES = [8, 16, 32];
const CONFIDENCE_THRESHOLD = 0.35;
const NMS_THRESHOLD = 0.45;

class DetectionService {
  private session: any | null = null;
  private modelInputShape: number[] = MODEL_INPUT_SHAPE;
  private numProposals = 0;
  private gridX: number[] = [];
  private gridY: number[] = [];
  private stridePerProposal: number[] = [];
  private channels = 0;

  async initialize(): Promise<void> {
    if (this.session) return;
    try {
      // Fetch the model from the local public path.
      const response = await fetch(MODEL_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch model from ${MODEL_URL}. Make sure the file exists in the /public directory.`);
      }
      const modelBuffer = await response.arrayBuffer();
      this.session = await ort.InferenceSession.create(modelBuffer, {
        // Fallback to WASM if WebGL is not available
        executionProviders: ['webgl', 'wasm'],
        graphOptimizationLevel: 'all',
      });
      this.prepareGrids();
      console.log('ONNX session initialized successfully from local model.');
    } catch (e) {
      console.error('Failed to initialize ONNX session:', e);
      throw e;
    }
  }

  async detectFaces(imageSource: ImageBitmapSource): Promise<BoundingBox[]> {
    if (!this.session) {
      throw new Error('Detection service not initialized.');
    }

    const [modelWidth, modelHeight] = this.modelInputShape.slice(2);
    // Get a drawable source along with dimensions to ensure type compatibility with drawImage.
    const [drawableSource, imageWidth, imageHeight] = await this.getDrawableAndDimensions(imageSource);

    const canvas = document.createElement('canvas');
    canvas.width = modelWidth;
    canvas.height = modelHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');

    // Use the guaranteed drawable source.
    ctx.drawImage(drawableSource, 0, 0, modelWidth, modelHeight);
    const imageData = ctx.getImageData(0, 0, modelWidth, modelHeight);
    const { data } = imageData;
    const red: number[] = [];
    const green: number[] = [];
    const blue: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      red.push(data[i] / 255);
      green.push(data[i + 1] / 255);
      blue.push(data[i + 2] / 255);
    }
    const transposedData = red.concat(green, blue);
    const inputTensor = new ort.Tensor('float32', transposedData, this.modelInputShape);

    const feeds = { [this.session.inputNames[0]]: inputTensor };
    const results = await this.session.run(feeds);

    const outputTensor = results[this.session.outputNames[0]];

    if (!this.channels && Array.isArray(outputTensor.dims) && outputTensor.dims.length >= 3) {
      this.channels = outputTensor.dims[1];
    } else if (!this.channels) {
      this.channels = 0;
    }

    return this.processOutput(outputTensor.data as Float32Array, imageWidth, imageHeight);
  }

  private async getDrawableAndDimensions(imageSource: ImageBitmapSource): Promise<[CanvasImageSource, number, number]> {
    if (imageSource instanceof HTMLVideoElement) return [imageSource, imageSource.videoWidth, imageSource.videoHeight];
    if (imageSource instanceof HTMLImageElement || imageSource instanceof HTMLCanvasElement || imageSource instanceof ImageBitmap) {
      return [imageSource, imageSource.width, imageSource.height];
    }
    // Fallback for OffscreenCanvas, Blob, ImageData by converting them to ImageBitmap.
    const bitmap = await createImageBitmap(imageSource);
    return [bitmap, bitmap.width, bitmap.height];
  }

  private prepareGrids() {
    const [modelWidth, modelHeight] = this.modelInputShape.slice(2);
    this.gridX = [];
    this.gridY = [];
    this.stridePerProposal = [];

    STRIDES.forEach((stride) => {
      const nx = Math.floor(modelWidth / stride);
      const ny = Math.floor(modelHeight / stride);
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          this.gridX.push(x);
          this.gridY.push(y);
          this.stridePerProposal.push(stride);
        }
      }
    });
    this.numProposals = this.gridX.length;
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private processOutput(output: Float32Array, imageWidth: number, imageHeight: number): BoundingBox[] {
    if (!this.numProposals) {
      console.warn('Detection grid not prepared.');
      return [];
    }

    const numChannels = this.channels || Math.floor(output.length / this.numProposals);
    if (numChannels < 5) {
      console.warn('Unexpected output shape from model. Not enough channels.');
      return [];
    }

    const [modelWidth, modelHeight] = this.modelInputShape.slice(2);
    const scaleX = imageWidth / modelWidth;
    const scaleY = imageHeight / modelHeight;

    const boxes: BoundingBox[] = [];

    for (let i = 0; i < this.numProposals; i++) {
      const stride = this.stridePerProposal[i];
      const gx = this.gridX[i];
      const gy = this.gridY[i];

      const xRaw = output[0 * this.numProposals + i];
      const yRaw = output[1 * this.numProposals + i];
      const wRaw = output[2 * this.numProposals + i];
      const hRaw = output[3 * this.numProposals + i];

      const objectness = this.sigmoid(output[4 * this.numProposals + i]);

      let classScore = 1;
      if (numChannels > 5) {
        let maxClassScore = 0;
        for (let c = 5; c < numChannels; c++) {
          const score = this.sigmoid(output[c * this.numProposals + i]);
          if (score > maxClassScore) {
            maxClassScore = score;
          }
        }
        classScore = maxClassScore;
      }

      const confidence = objectness * classScore;
      if (confidence < CONFIDENCE_THRESHOLD) continue;

      const xCenter = (this.sigmoid(xRaw) * 2 - 0.5 + gx) * stride;
      const yCenter = (this.sigmoid(yRaw) * 2 - 0.5 + gy) * stride;
      const width = (this.sigmoid(wRaw) * 2) ** 2 * stride;
      const height = (this.sigmoid(hRaw) * 2) ** 2 * stride;

      const x = this.clamp((xCenter - width / 2) * scaleX, 0, imageWidth);
      const y = this.clamp((yCenter - height / 2) * scaleY, 0, imageHeight);
      const w = this.clamp(width * scaleX, 1, imageWidth);
      const h = this.clamp(height * scaleY, 1, imageHeight);

      boxes.push({ x, y, w, h, confidence });
    }

    return this.nonMaxSuppression(boxes, NMS_THRESHOLD);
  }

  private nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
    if (boxes.length <= 1) return boxes;

    const sorted = [...boxes].sort((a, b) => b.confidence - a.confidence);
    const selected: BoundingBox[] = [];

    while (sorted.length) {
      const current = sorted.shift()!;
      selected.push(current);
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (this.iou(current, sorted[i]) > iouThreshold) {
          sorted.splice(i, 1);
        }
      }
    }

    return selected;
  }

  private iou(a: BoundingBox, b: BoundingBox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (intersection <= 0) return 0;

    const union = a.w * a.h + b.w * b.h - intersection;
    return union <= 0 ? 0 : intersection / union;
  }
}

export const detectionService = new DetectionService();

