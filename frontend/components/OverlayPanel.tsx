// src/components/OverlayPanel.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { AppStatus, EmotionData } from '../types';
import { useDraggable } from '../hooks/useDraggable';
import EmotionDisplay from "./EmotionDisplay";

interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
}

interface OverlayPanelProps {
  status: AppStatus;
  isEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  messages: ChatMessage[];
  lastUpload: string | null;
  error: string | null;
  emotions: EmotionData[] | null;
  contextText: string;
  setContextText: (val: string) => void;
  isStarting?: boolean;
}

const COLLAPSED_KEY = 'emoTutorPanelCollapsed';
const PANEL_WIDTH = 440; // px
const RAIL_WIDTH = 40; // px (visible rail when collapsed)

const StatusIndicator: React.FC<{ status: AppStatus }> = ({ status }) => {
  const colorMap: Record<AppStatus, string> = {
    [AppStatus.Idle]: 'bg-gray-400',
    [AppStatus.Initializing]: 'bg-blue-400',
    [AppStatus.Detecting]: 'bg-yellow-400',
    [AppStatus.Uploading]: 'bg-purple-400',
    [AppStatus.Error]: 'bg-red-500',
  };
  return <div className={`w-3 h-3 rounded-full ${colorMap[status]}`} title={status} aria-hidden="true" />;
};

export const OverlayPanel: React.FC<OverlayPanelProps> = React.memo(({
  status,
  isEnabled,
  onToggle,
  messages,
  lastUpload,
  error,
  emotions,
  contextText,
  setContextText,
  isStarting = false,
}) => {
  const { ref, style, onMouseDown } = useDraggable();
  const [showEmotions, setShowEmotions] = useState(true);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? 'true' : 'false');
    } catch {}
  }, [collapsed]);

  const handleToggleChange = useCallback((checked: boolean) => {
    if (isStarting) return;
    onToggle(checked);
  }, [onToggle, isStarting]);

  const handleSwitchKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isStarting) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(!isEnabled);
    }
  }, [isEnabled, onToggle, isStarting]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((s) => !s);
  }, []);

  return (
    <>
      {/* Fixed rail button on the right edge (always visible) */}
      <div
        className="fixed right-0 top-0 h-screen flex items-start z-[100000]"
        style={{ pointerEvents: 'auto' }}
        aria-hidden={false}
      >
        {/* Show rail only when collapsed; when expanded keep it but visually hidden (so layout consistent) */}
        <div className={`flex items-center justify-center p-1 h-screen select-none ${collapsed ? 'block' : 'hidden'}`}>
          <button
            onClick={toggleCollapse}
            aria-label="Open EmoTutor panel"
            title="Open EmoTutor"
            className="w-10 h-10 rounded-l-lg bg-gray-800/80 hover:bg-gray-700 flex items-center justify-center shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <svg className="w-5 h-5 text-white" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M13 5L7 10L13 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel: fixed at right:0; we animate with transform (translateX) so motion is relative to panel width */}
      <div
        ref={ref}
        style={{
          ...style,
          width: PANEL_WIDTH,
          transform: collapsed ? `translateX(${PANEL_WIDTH}px)` : 'translateX(0)',
          transition: 'transform 240ms ease-in-out, opacity 200ms ease-in-out',
          opacity: collapsed ? 0 : 1,
          right: 0,
          top: 0,
        } as React.CSSProperties}
        className={`
          fixed z-[99999]
          bg-gray-900/95 backdrop-blur-xl text-white shadow-2xl font-sans
          border-l border-gray-800/60 flex flex-col
          max-h-screen
        `}
        role="dialog"
        aria-label="EmoTutor overlay panel"
      >
        {/* Header (draggable) */}
        <div
          onMouseDown={onMouseDown}
          className="px-4 py-3 border-b border-gray-800 flex justify-between items-center cursor-move"
          tabIndex={0}
          aria-label="Move panel"
        >
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-lg">EmoTutor</h1>
            <div className="flex items-center space-x-2">
              <StatusIndicator status={status} />
              <span className="text-xs text-gray-300" aria-live="polite">{status}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Collapse button */}
            <button
              onClick={toggleCollapse}
              aria-label={collapsed ? "Open panel" : "Collapse panel"}
              title={collapsed ? "Open panel" : "Collapse panel"}
              className="p-1 rounded-md hover:bg-gray-800/60 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <svg className="w-5 h-5 text-gray-200" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M7 5L13 10L7 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="px-4 py-4 flex flex-col flex-1 gap-4 overflow-auto min-h-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Capture</span>

            {/* Accessible switch: hidden checkbox + visible interactive div */}
            <div
              role="switch"
              aria-checked={isEnabled}
              tabIndex={0}
              onKeyDown={handleSwitchKey}
              aria-disabled={isStarting}
              className="flex items-center"
              aria-label={isStarting ? 'Starting capture' : (isEnabled ? 'Disable capture' : 'Enable capture')}
            >
              <input
                type="checkbox"
                id="capture-toggle"
                className="sr-only"
                checked={isEnabled}
                onChange={(e) => handleToggleChange(e.target.checked)}
                aria-checked={isEnabled}
                disabled={isStarting}
                aria-busy={isStarting}
              />
              <div
                onClick={() => handleToggleChange(!isEnabled)}
                className={`relative inline-block w-14 h-8 rounded-full transition-colors ${isStarting ? 'bg-gray-500 cursor-not-allowed' : 'bg-gray-600 cursor-pointer'}`}
                aria-hidden="true"
              >
                <div
                  className={`absolute left-1 top-1 w-6 h-6 rounded-full transition-transform ${isEnabled ? 'translate-x-6 bg-green-400' : 'bg-white'} ${isStarting ? 'opacity-70' : ''}`}
                />
              </div>
            </div>
          </div>

          <div className="mt-2">
            <label htmlFor="context" className="text-xs text-gray-400">Context</label>
            <input
              id="context"
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              placeholder="Meeting topic (sent to AI)"
              className="mt-1 w-full bg-gray-800 text-sm text-white rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sky-500"
              aria-label="Context for AI"
            />
          </div>

          <div>
            <button
              onClick={() => setShowEmotions(!showEmotions)}
              className="w-full text-left text-xs text-gray-400 hover:text-white mb-2"
              aria-expanded={showEmotions}
              aria-controls="emotion-display"
            >
              {showEmotions ? '▼ Hide Emotions' : '► Show Emotions'}
            </button>
          </div>

          <div id="emotion-display" className="flex-1 min-h-0">
            <EmotionDisplay emotions={emotions ?? []} messages={messages} showEmotions={showEmotions} />
          </div>

          <div className="pt-2">
            {lastUpload && <p className="text-xs text-gray-400 text-center">Last upload: {lastUpload}</p>}
            {error && (
              <div className="mt-2">
                <h2 className="text-sm font-semibold text-red-400 mb-1">Error</h2>
                <p className="text-sm bg-red-900 bg-opacity-50 p-2 rounded-md" role="alert">
                  {error}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

export default OverlayPanel;
