import React, { useMemo, useEffect, useRef, useState } from "react";
import { EmotionData } from "../types";
import FeedbackChat from "./FeedbackChat";

interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
}

interface EmotionDisplayProps {
  emotions: EmotionData[]; // expected: { label: string; score: number }[]
  messages?: ChatMessage[]; // chat messages
  showEmotions?: boolean; // when false, only chat is shown
  maxShown?: number; // how many emotion bars to show (top N)
}

const emotionMap: Record<string, { emoji: string; color: string }> = {
  neutral: { emoji: "😐", color: "bg-gray-500" },
  happy: { emoji: "😊", color: "bg-yellow-400" },
  sad: { emoji: "😢", color: "bg-blue-500" },
  anger: { emoji: "😠", color: "bg-red-500" },
  fear: { emoji: "😨", color: "bg-purple-500" },
  disgust: { emoji: "🤢", color: "bg-green-700" },
  surprise: { emoji: "😮", color: "bg-pink-500" },
  default: { emoji: "❓", color: "bg-gray-400" },
};

const getEmotionStyle = (label?: string) => {
  if (!label) return emotionMap.default;
  return emotionMap[label.toLowerCase()] || emotionMap.default;
};

const EmotionDisplay: React.FC<EmotionDisplayProps> = ({
  emotions,
  messages = [],
  showEmotions = true,
  maxShown = 6,
}) => {
  // normalize and sort emotions once
  const normalized = useMemo(() => {
    if (!Array.isArray(emotions) || emotions.length === 0) return [];
    return emotions
      .map((e) => {
        const label = (e?.label ?? "unknown").toString();
        const raw = Number(e?.score ?? 0);
        // ensure a 0..1 range; if score looks like 0-100, normalize it heuristically
        let score = Number.isFinite(raw) ? raw : 0;
        if (score > 1 && score <= 100) score = score / 100;
        score = Math.max(0, Math.min(1, score));
        return { label, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxShown);
  }, [emotions, maxShown]);

  // announcer state for aria-live
  const [announcement, setAnnouncement] = useState<string>("");
  const prevTopRef = useRef<string | null>(null);
  const clearTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const top = normalized[0];
    if (!top) {
      // clear when no top emotion
      prevTopRef.current = null;
      setAnnouncement("");
      return;
    }

    const topKey = `${top.label}-${Math.round(top.score * 100)}`;
    if (prevTopRef.current !== topKey) {
      prevTopRef.current = topKey;
      const pct = Math.round(top.score * 100);
      const text = `Top emotion: ${top.label}, ${pct} percent.`;
      setAnnouncement(text);

      // optionally clear the announcement after a short time so it doesn't persist
      if (clearTimeoutRef.current) {
        window.clearTimeout(clearTimeoutRef.current);
      }
      clearTimeoutRef.current = window.setTimeout(() => {
        setAnnouncement("");
        clearTimeoutRef.current = null;
      }, 4000); // clear after 4s (adjust as needed)
    }
    // cleanup on unmount
    return () => {
      if (clearTimeoutRef.current) {
        window.clearTimeout(clearTimeoutRef.current);
        clearTimeoutRef.current = null;
      }
    };
  }, [normalized]);

  // small inline style used for subtle text shadow because Tailwind doesn't have a default utility
  const pctTextShadow = { textShadow: "0 1px 0 rgba(0,0,0,0.6)" };

  return (
    <div className="flex flex-col h-full">
      {/* Visually-hidden announcer for screen readers */}
      {/* Tailwind's 'sr-only' makes this hidden visually but exposed to assistive tech */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        // We keep the announcer in the DOM; updating `announcement` triggers screen readers.
      >
        {announcement}
      </div>

      {showEmotions ? (
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-400">Dominant Emotions</h2>

          {normalized.length === 0 ? (
            <p className="text-xs text-gray-500 mt-2">No emotions detected yet.</p>
          ) : (
            <div className="space-y-2 mt-2" role="list" aria-label="Detected emotions">
              {normalized.map(({ label, score }, idx) => {
                const { emoji, color } = getEmotionStyle(label);
                const pct = Math.round(score * 100);
                const pctLabel = `${pct}%`;
                // use a stable key (label + index) to handle duplicate labels gracefully
                const key = `${label}-${idx}`;

                return (
                  <div key={key} className="flex items-center text-xs" role="listitem" aria-label={`${label} ${pctLabel}`}>
                    <span className="w-1/3 truncate text-slate-200 flex items-center gap-2">
                      <span aria-hidden="true">{emoji}</span>
                      <span className="capitalize">{label}</span>
                    </span>

                    <div className="w-2/3 bg-slate-700 rounded-full h-4 relative overflow-hidden">
                      <div
                        className={`${color} h-4 rounded-full flex items-center justify-end pr-2 transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                      >
                        <span
                          className="text-white font-bold text-[11px]"
                          style={pctTextShadow}
                          aria-live="polite"
                        >
                          {pctLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Chat area grows to fill remaining vertical space */}
      <div className="mt-3 flex-1 min-h-0 overflow-auto" aria-label="Feedback chat">
        <FeedbackChat messages={messages} height="100%" />
      </div>
    </div>
  );
};

export default React.memo(EmotionDisplay);
