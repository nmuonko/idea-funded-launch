import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ProductImageViewerProps {
  images: string[];
  currentIndex: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

export function ProductImageViewer({ images, currentIndex, onClose, onIndexChange }: ProductImageViewerProps) {
  const [index, setIndex] = useState(currentIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Touch/pointer tracking refs
  const pointerCache = useRef<PointerEvent[]>([]);
  const lastPinchDist = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const translateStart = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);
  const swipeStartX = useRef<number | null>(null);
  const hasMoved = useRef(false);

  const isZoomed = scale > 1.05;

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    lastPinchDist.current = null;
  }, []);

  const goTo = useCallback((newIndex: number) => {
    resetZoom();
    setIndex(newIndex);
    onIndexChange?.(newIndex);
  }, [resetZoom, onIndexChange]);

  const next = useCallback(() => {
    if (images.length <= 1) return;
    goTo((index + 1) % images.length);
  }, [index, images.length, goTo]);

  const prev = useCallback(() => {
    if (images.length <= 1) return;
    goTo((index - 1 + images.length) % images.length);
  }, [index, images.length, goTo]);

  // Keyboard nav
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handleKey);
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [onClose, next, prev]);

  // Clamp translate so image doesn't go too far off screen
  const clampTranslate = useCallback((tx: number, ty: number, s: number) => {
    const maxOffset = Math.max(0, (s - 1) * 150);
    return {
      x: Math.max(-maxOffset, Math.min(maxOffset, tx)),
      y: Math.max(-maxOffset, Math.min(maxOffset, ty)),
    };
  }, []);

  // --- Pointer events for unified touch+mouse ---
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (el) el.setPointerCapture(e.pointerId);
    pointerCache.current.push(e.nativeEvent);
    hasMoved.current = false;

    if (pointerCache.current.length === 1) {
      // Single finger/click
      dragStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = { ...translate };
      swipeStartX.current = e.clientX;

      // Double-tap detection
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double tap -> toggle zoom
        if (isZoomed) {
          resetZoom();
        } else {
          setScale(2.5);
        }
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  }, [translate, isZoomed, resetZoom]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    // Update cache
    const idx = pointerCache.current.findIndex(p => p.pointerId === e.pointerId);
    if (idx >= 0) pointerCache.current[idx] = e.nativeEvent;

    if (pointerCache.current.length === 2) {
      // Pinch zoom
      const [p1, p2] = pointerCache.current;
      const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      if (lastPinchDist.current !== null) {
        const delta = dist / lastPinchDist.current;
        setScale(prev => Math.max(1, Math.min(4, prev * delta)));
      }
      lastPinchDist.current = dist;
      hasMoved.current = true;
    } else if (pointerCache.current.length === 1 && dragStart.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved.current = true;

      if (isZoomed) {
        // Pan
        const newT = clampTranslate(
          translateStart.current.x + dx,
          translateStart.current.y + dy,
          scale
        );
        setTranslate(newT);
      }
    }
  }, [isZoomed, scale, clampTranslate]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    // Swipe detection (single finger, not zoomed)
    if (!isZoomed && pointerCache.current.length === 1 && swipeStartX.current !== null) {
      const dx = e.clientX - swipeStartX.current;
      if (Math.abs(dx) > 60 && hasMoved.current) {
        if (dx < 0) next();
        else prev();
      }
    }

    pointerCache.current = pointerCache.current.filter(p => p.pointerId !== e.pointerId);
    if (pointerCache.current.length < 2) lastPinchDist.current = null;
    if (pointerCache.current.length === 0) {
      dragStart.current = null;
      swipeStartX.current = null;
    }
  }, [isZoomed, next, prev]);

  // Wheel zoom (desktop)
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(prev => {
      const newScale = Math.max(1, Math.min(4, prev - e.deltaY * 0.003));
      if (newScale <= 1.05) {
        setTranslate({ x: 0, y: 0 });
      }
      return newScale;
    });
  }, []);

  // Close on backdrop click (not on image)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !hasMoved.current) {
      onClose();
    }
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <span className="text-white/70 text-sm font-medium">
          {index + 1} / {images.length}
        </span>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onClick={handleBackdropClick}
      >
        <img
          src={images[index] || '/placeholder.svg'}
          alt={`Image ${index + 1}`}
          className="max-w-full max-h-full object-contain pointer-events-none"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: hasMoved.current ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>

      {/* Desktop arrow buttons */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-10 items-center justify-center w-11 h-11 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Dot indicators */}
      {images.length > 1 && images.length <= 10 && (
        <div className="absolute bottom-6 left-0 right-0 z-10 flex justify-center gap-1.5" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2 h-2 rounded-full transition-all ${i === index ? 'bg-white w-4' : 'bg-white/40'}`}
              aria-label={`Go to image ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
