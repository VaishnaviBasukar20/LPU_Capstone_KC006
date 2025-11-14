
import React, { useState, useCallback, useRef, useEffect } from 'react';

export const useDraggable = () => {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (elementRef.current) {
      isDraggingRef.current = true;
      const rect = elementRef.current.getBoundingClientRect();
      offsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      document.body.style.userSelect = 'none'; // Prevent text selection
    }
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      const newX = e.clientX - offsetRef.current.x;
      const newY = e.clientY - offsetRef.current.y;
      setPosition({ x: newX, y: newY });
    }
  }, []);

  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  return {
    ref: elementRef,
    style: {
      position: 'fixed' as const,
      left: `${position.x}px`,
      top: `${position.y}px`,
      cursor: 'move',
      touchAction: 'none',
    },
    onMouseDown,
  };
};
