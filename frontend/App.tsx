// src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppStatus, ProcessedFace, EmotionData } from './types';
import { OverlayPanel } from './components/OverlayPanel';
import { Onboarding } from './components/Onboarding';
import { detectionService } from './services/detectionService';
import { cropResizeToBlob } from './utils/imageUtils';
import { analyzeFaces } from './services/apiService';

const CAPTURE_INTERVAL_MS = 10000;
const ONBOARDING_KEY = 'emoTutorOnboarded';
const CONTEXT_KEY = 'emoTutorContext';

type ChatMessage = {
  id: string;
  text: string;
  timestamp: string;
};

function App() {
  // context persisted to localStorage
  const [contextText, setContextText] = useState<string>(() => {
    return localStorage.getItem(CONTEXT_KEY) ?? 'AI Summit';
  });

  useEffect(() => {
    localStorage.setItem(CONTEXT_KEY, contextText);
  }, [contextText]);

  const [isEnabled, setIsEnabled] = useState(false);
  const [isStarting, setIsStarting] = useState(false); // prevents repeated toggles while warm-up
  const [status, setStatus] = useState<AppStatus>(AppStatus.Initializing);
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emotions, setEmotions] = useState<EmotionData[] | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Chat messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Prevent overlapping uploads
  const isUploadingRef = useRef(false);

  // Loop control refs to avoid stale closures
  const runLoopRef = useRef(false);     // true while capture loop is running
  const enabledRef = useRef(isEnabled); // always reflect latest isEnabled

  useEffect(() => {
    enabledRef.current = isEnabled;
    if (!isEnabled) {
      runLoopRef.current = false;
    }
  }, [isEnabled]);

  useEffect(() => {
    const hasOnboarded = localStorage.getItem(ONBOARDING_KEY);
    if (!hasOnboarded) {
      setShowOnboarding(true);
    }

    const init = async () => {
      try {
        await detectionService.initialize();
        setStatus(AppStatus.Idle);
      } catch (e) {
        setError("Failed to load face detection model. Please refresh.");
        setStatus(AppStatus.Error);
        console.error(e);
      }
    };
    init();
    // debug
    console.log('App mounted');
  }, []);

  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setShowOnboarding(false);
  };

  const captureAndProcess = useCallback(async () => {
    if (isUploadingRef.current) {
      console.log("Skipping frame, upload in progress.");
      return;
    }

    try {
      setError(null);
      isUploadingRef.current = true;

      // Find the largest video element on the page
      let videoElement: HTMLVideoElement | null = null;
      const videos = Array.from(document.getElementsByTagName('video'));
      if (videos.length > 0) {
        videoElement = videos.reduce((prev, current) =>
          prev.offsetHeight * prev.offsetWidth > current.offsetHeight * current.offsetWidth ? prev : current
        );
      }

      if (!videoElement || videoElement.readyState < 2) {
        console.warn("No suitable video element found or ready. Skipping capture.");
        isUploadingRef.current = false;
        return;
      }

      // Snapshot
      const source: ImageBitmapSource = await createImageBitmap(videoElement);

      setStatus(AppStatus.Detecting);
      const bboxes = await detectionService.detectFaces(source);
      if (bboxes.length === 0) {
        setStatus(AppStatus.Idle);
        isUploadingRef.current = false;
        return;
      }

      const sortedDetections = bboxes
        .map(b => ({ ...b, score: b.confidence * (b.w * b.h) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      const faceProcessingPromises = sortedDetections.map(async (bbox, index): Promise<ProcessedFace | null> => {
        try {
          const { blob } = await cropResizeToBlob(source, bbox);
          return {
            blob,
            metadata: {
              index,
              bbox: [bbox.x, bbox.y, bbox.w, bbox.h],
              confidence: bbox.confidence,
            },
          };
        } catch (e) {
          console.warn("Failed to process a face:", e);
          return null;
        }
      });

      const processedFaces = (await Promise.all(faceProcessingPromises)).filter(
        (f): f is ProcessedFace => f !== null
      );

      if (processedFaces.length === 0) {
        console.log("No faces survived compression.");
        setStatus(AppStatus.Idle);
        isUploadingRef.current = false;
        return;
      }

      setStatus(AppStatus.Uploading);
      const result = await analyzeFaces(processedFaces, contextText);

      // update UI
      setEmotions(result.top3_aggregate);
      setLastUpload(new Date().toLocaleTimeString());
      const text = result.gemini_feedback ?? "No feedback returned.";
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), text, timestamp: new Date().toLocaleTimeString() },
      ]);

      setStatus(AppStatus.Idle);

      // Clearing isStarting after a successful first run (if it was starting)
      if (isStarting) setIsStarting(false);
    } catch (e: any) {
      console.error("Processing failed:", e);
      setError(e.message || "An unknown error occurred.");
      setEmotions(null);
      setStatus(AppStatus.Error);
      if (isStarting) setIsStarting(false);
    } finally {
      isUploadingRef.current = false;
    }
  }, [contextText, isStarting]);

  // Main capture loop:
  useEffect(() => {
    if (isEnabled && status !== AppStatus.Initializing && !showOnboarding && !runLoopRef.current) {
      runLoopRef.current = true;

      (async function captureLoop() {
        // yield so UI can update to show toggle state
        await new Promise((resolve) => setTimeout(resolve, 0));

        // optional small warm-up so the user sees status change
        setStatus(AppStatus.Detecting);
        await new Promise((resolve) => setTimeout(resolve, 120));

        while (runLoopRef.current && enabledRef.current) {
          try {
            await captureAndProcess();
          } catch (e) {
            console.error('captureLoop error', e);
          }

          if (!enabledRef.current || !runLoopRef.current) break;
          await new Promise((resolve) => setTimeout(resolve, CAPTURE_INTERVAL_MS));
        }
        runLoopRef.current = false;
      })();
    }

    return () => {
      runLoopRef.current = false;
    };
  }, [isEnabled, status, showOnboarding, captureAndProcess]);

  const handleToggle = (enabled: boolean) => {
    // avoid enabling while model still initializing
    if (enabled && status === AppStatus.Initializing) {
      setError('Model is still initializing. Please wait a moment.');
      return;
    }

    // If enabling, set isStarting to block repeated toggles until first capture finishes
    if (enabled) {
      setIsStarting(true);
    }

    setIsEnabled(enabled);

    if (!enabled) {
      setStatus(AppStatus.Idle);
      setError(null);
      setEmotions(null);
      setIsStarting(false);
    }
  };

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <OverlayPanel
      status={status}
      isEnabled={isEnabled}
      onToggle={handleToggle}
      messages={messages}
      lastUpload={lastUpload}
      error={error}
      emotions={emotions}
      contextText={contextText}
      setContextText={setContextText}
      // we don't strictly need to pass isStarting, but it can help UI to disable toggles:
      isStarting={isStarting}
    />
  );
}

export default App;
