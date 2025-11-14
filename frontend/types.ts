// src/types.ts
export enum AppStatus {
  Idle = "Idle",
  Detecting = "Detecting",
  Uploading = "Uploading",
  Error = "Error",
  Initializing = "Initializing",
}

export interface ProcessedFace {
  blob: Blob;
  metadata: {
    index: number;
    bbox: [number, number, number, number];
    confidence: number;
  };
}

/* Backend types */
export interface BackendEmotion {
  label: string;
  confidence: number;
}

export interface ImageResult {
  index: number;
  top3: BackendEmotion[];
}

export interface AnalysisResponse {
  images: ImageResult[];
  top3_aggregate: BackendEmotion[]; // backend uses `confidence`
  gemini_feedback: string;
  timings: Record<string, any>;
}

/* App-friendly UI type */
export interface EmotionData {
  label: string;
  score: number; // 0..1
}

/* Chat message */
export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
}
