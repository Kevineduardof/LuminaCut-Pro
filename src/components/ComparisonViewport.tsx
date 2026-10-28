import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Columns,
  Eye,
  Image as ImageIcon,
  Layers,
  Move,
  Search,
} from 'lucide-react';
import { BackdropOptions } from '../utils/imageProcessor';

export type ViewportMode = 'split' | 'cutout' | 'original' | 'mask';

interface ComparisonViewportProps {
  originalUrl: string;
  cutoutUrl: string;
  width: number;
  height: number;
  viewMode: ViewportMode;
  onViewModeChange: (mode: ViewportMode) => void;
  backdrop: BackdropOptions;
  isProcessing: boolean;
  progressText: string;
  progressPercent: number;
}

interface LoupeRenderState {
  /** Cursor position relative to containerRef in px */
  containerX: number;
  containerY: number;
  /** Exact background-size in px (imgRect * magnification) */
  bgWidth: number;
  bgHeight: number;
  /** Exact background-position in px so the pixel under cursor is at the center crosshair */
  bgPosX: number;
  bgPosY: number;
  /** In split mode, percentage (0..100) of the loupe width where the Original/Cutout split line falls */
  loupeSplitPct: number;
}

const LOUPE_SIZE = 168; // diameter in px
const LOUPE_MAGNIFICATION = 4; // 4x magnification relative to current rendered image size

export const ComparisonViewport: React.FC<ComparisonViewportProps> = ({
  originalUrl,
  cutoutUrl,
  width,
  height,
  viewMode,
  onViewModeChange,
  backdrop,
  isProcessing,
  progressText,
  progressPercent,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [sliderPos, setSliderPos] = useState<number>(50); // 0 to 100% of container width
  const [isDraggingSlider, setIsDraggingSlider] = useState<boolean>(false);

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Precision Magnifier Loupe state
  const [loupeEnabled, setLoupeEnabled] = useState<boolean>(false);
  const [loupeState, setLoupeState] = useState<LoupeRenderState | null>(null);
  const lastMouseClientRef = useRef<{ x: number; y: number } | null>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleZoomDelta = (delta: number) => {
    setZoom((prev) => {
      const next = Math.min(8, Math.max(0.5, Number((prev + delta).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  /**
   * Computes the exact pixel coordinates of the cursor inside the rendered <img> bounding box,
   * accounting for any zoom, pan, aspect ratio, or flexbox centering without CSS transition lag.
   */
  const computeLoupeFromClientPos = useCallback(
    (clientX: number, clientY: number) => {
      if (!loupeEnabled || !containerRef.current || !imageRef.current) {
        setLoupeState(null);
        return;
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imageRef.current.getBoundingClientRect();

      // Check if cursor is actually inside the rendered image bounds
      const isInsideImage =
        imgRect.width > 0 &&
        imgRect.height > 0 &&
        clientX >= imgRect.left &&
        clientX <= imgRect.right &&
        clientY >= imgRect.top &&
        clientY <= imgRect.bottom;

      if (!isInsideImage) {
        setLoupeState(null);
        return;
      }

      // Exact normalized position [0..1] on the rendered image
      const imgNormX = (clientX - imgRect.left) / imgRect.width;
      const imgNormY = (clientY - imgRect.top) / imgRect.height;

      // Scale background relative to the currently rendered image dimensions
      const bgWidth = imgRect.width * LOUPE_MAGNIFICATION;
      const bgHeight = imgRect.height * LOUPE_MAGNIFICATION;

      // Place the exact sampled image point at the center of the loupe (LOUPE_SIZE / 2)
      const bgPosX = LOUPE_SIZE / 2 - imgNormX * bgWidth;
      const bgPosY = LOUPE_SIZE / 2 - imgNormY * bgHeight;

      const containerX = clientX - containerRect.left;
      const containerY = clientY - containerRect.top;

      // Calculate where the split bar intersects the loupe lens so even inside the loupe
      // the Antes / Depois line is 100% calibrated with the bar!
      let loupeSplitPct = 0;
      if (viewMode === 'original') {
        loupeSplitPct = 100;
      } else if (viewMode === 'split') {
        const sliderBarX = (sliderPos / 100) * containerRect.width;
        const deltaFromCursor = (sliderBarX - containerX) * LOUPE_MAGNIFICATION;
        const splitPxInLoupe = LOUPE_SIZE / 2 + deltaFromCursor;
        loupeSplitPct = Math.min(100, Math.max(0, (splitPxInLoupe / LOUPE_SIZE) * 100));
      }

      setLoupeState({
        containerX,
        containerY,
        bgWidth,
        bgHeight,
        bgPosX,
        bgPosY,
        loupeSplitPct,
      });
    },
    [loupeEnabled, viewMode, sliderPos]
  );

  // Recalculate loupe synchronously after DOM layout whenever zoom, pan, or sliderPos changes
  useLayoutEffect(() => {
    if (!loupeEnabled) {
      setLoupeState(null);
      return;
    }
    if (lastMouseClientRef.current) {
      computeLoupeFromClientPos(
        lastMouseClientRef.current.x,
        lastMouseClientRef.current.y
      );
    }
  }, [zoom, pan, sliderPos, loupeEnabled, computeLoupeFromClientPos]);

  // Mouse wheel zoom inside viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
      const factor = e.deltaY < 0 ? 0.25 : -0.25;
      setZoom((prev) => {
        const next = Math.min(8, Math.max(0.5, Number((prev + factor).toFixed(2))));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Update slider position on drag
  const updateSliderFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const percentage = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.min(100, Math.max(0, percentage)));
  }, []);

  useEffect(() => {
    if (!isDraggingSlider && !isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
      if (isDraggingSlider) {
        updateSliderFromClientX(e.clientX);
      } else if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      if (isDraggingSlider) {
        updateSliderFromClientX(touch.clientX);
      } else if (isPanning) {
        setPan({
          x: touch.clientX - panStart.x,
          y: touch.clientY - panStart.y,
        });
      }
    };

    const handleUp = () => {
      setIsDraggingSlider(false);
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [isDraggingSlider, isPanning, panStart, updateSliderFromClientX]);

  const handleViewportMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleViewportMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    lastMouseClientRef.current = { x: e.clientX, y: e.clientY };
    computeLoupeFromClientPos(e.clientX, e.clientY);
  };

  // Compute backdrop styling
  const getBackdropClass = () => {
    if (viewMode === 'mask') return 'bg-black';
    if (backdrop.type === 'transparent-light') return 'bg-checkerboard-light';
    if (backdrop.type === 'transparent-dark') return 'bg-checkerboard-dark';
    return '';
  };

  const getBackdropStyle = (): React.CSSProperties => {
    if (viewMode === 'mask') return {};
    if (backdrop.type === 'solid') {
      return { backgroundColor: backdrop.solidColor };
    }
    if (backdrop.type === 'gradient') {
      return {
        backgroundImage: `linear-gradient(135deg, ${backdrop.gradientFrom}, ${backdrop.gradientTo})`,
      };
    }
    return {};
  };

  // Synchronous transform without transition delay so getBoundingClientRect() and clip lines
  // stay 100% locked at every zoom distance (50% to 800%) and pan offset.
  const stageTransformStyle: React.CSSProperties = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
    transformOrigin: 'center center',
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Top Toolbar: View Modes & Zoom Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900/95 border-b border-slate-800">
        {/* View Mode Selector */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => onViewModeChange('split')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'split'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Antes / Depois</span>
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('cutout')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'cutout'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Sem Fundo</span>
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('original')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'original'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Original</span>
          </button>

          <button
            type="button"
            onClick={() => onViewModeChange('mask')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              viewMode === 'mask'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Inspecionar máscara de recorte alfa em preto e branco"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Máscara Alfa</span>
          </button>
        </div>

        {/* High-Precision Zoom & Loupe Bar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLoupeEnabled((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              loupeEnabled
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
            title="Ativar Lupa de Inspeção de Pixels (4x)"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Lupa 4×</span>
          </button>

          <div className="flex items-center bg-slate-950 rounded-xl border border-slate-800 p-0.5">
            <button
              type="button"
              onClick={() => handleZoomDelta(-0.25)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Diminuir Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <span className="px-2.5 text-xs font-mono font-semibold text-slate-200 min-w-[54px] text-center">
              {Math.round(zoom * 100)}%
            </span>

            <button
              type="button"
              onClick={() => handleZoomDelta(0.25)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Aumentar Zoom (até 800%)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <div className="h-4 w-px bg-slate-800 mx-0.5" />

            {[1, 2, 4].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setZoom(preset);
                  if (preset === 1) setPan({ x: 0, y: 0 });
                }}
                className={`px-2 py-1 text-[11px] font-mono rounded-md transition-colors ${
                  Math.abs(zoom - preset) < 0.05
                    ? 'bg-indigo-600/30 text-indigo-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset}x
              </button>
            ))}

            <button
              type="button"
              onClick={resetView}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors ml-0.5"
              title="Centralizar e Resetar Zoom"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Canvas Viewport */}
      <div
        ref={containerRef}
        onMouseDown={handleViewportMouseDown}
        onMouseMove={handleViewportMouseMove}
        onMouseLeave={() => {
          lastMouseClientRef.current = null;
          setLoupeState(null);
        }}
        style={getBackdropStyle()}
        className={`relative flex-1 min-h-[480px] flex items-center justify-center overflow-hidden select-none ${getBackdropClass()} ${
          loupeEnabled && loupeState
            ? 'cursor-none'
            : isPanning
            ? 'cursor-grabbing'
            : 'cursor-grab'
        }`}
      >
        {/* Layer 1: Base Image Stage (Cutout or Original) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            style={stageTransformStyle}
            className="relative inline-flex items-center justify-center max-w-full max-h-full p-4"
          >
            <img
              ref={imageRef}
              src={viewMode === 'original' ? originalUrl : cutoutUrl || originalUrl}
              alt="Resultado processado em alta resolução"
              draggable={false}
              style={{
                imageRendering: zoom >= 3 ? 'pixelated' : 'auto',
              }}
              className="max-h-[68vh] max-w-full w-auto h-auto object-contain rounded-lg shadow-2xl pointer-events-none"
            />
          </div>
        </div>

        {/* Layer 2: Before / After Overlay Layer clipped at container level so it ALWAYS matches the slider bar at any zoom or pan */}
        {viewMode === 'split' && cutoutUrl && (
          <div
            style={{
              clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
            }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div
              style={stageTransformStyle}
              className="relative inline-flex items-center justify-center max-w-full max-h-full p-4"
            >
              <img
                src={originalUrl}
                alt="Imagem Original"
                draggable={false}
                style={{
                  imageRendering: zoom >= 3 ? 'pixelated' : 'auto',
                }}
                className="max-h-[68vh] max-w-full w-auto h-auto object-contain rounded-lg pointer-events-none"
              />
            </div>
          </div>
        )}

        {/* Interactive Split Slider Handle */}
        {viewMode === 'split' && cutoutUrl && (
          <div
            style={{ left: `${sliderPos}%` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setIsDraggingSlider(true);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              setIsDraggingSlider(true);
            }}
            className="absolute top-0 bottom-0 z-20 w-1 -ml-0.5 bg-white/90 shadow-[0_0_15px_rgba(0,0,0,0.8)] cursor-ew-resize group"
          >
            {/* Center Grab Pill */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-indigo-600 border-2 border-white shadow-xl flex items-center justify-center transition-transform group-hover:scale-110">
              <div className="flex items-center gap-0.5">
                <div className="w-0 h-0 border-y-[5px] border-y-transparent border-r-[6px] border-r-white" />
                <div className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[6px] border-l-white" />
              </div>
            </div>

            {/* Labels */}
            <div className="absolute top-4 right-3 px-2.5 py-1 rounded-md bg-slate-950/85 backdrop-blur-md border border-slate-700/70 text-[11px] font-semibold text-slate-200 tracking-wide uppercase pointer-events-none whitespace-nowrap">
              Original
            </div>
            <div className="absolute top-4 left-3 px-2.5 py-1 rounded-md bg-indigo-600/90 backdrop-blur-md border border-indigo-400/50 text-[11px] font-semibold text-white tracking-wide uppercase pointer-events-none whitespace-nowrap">
              Sem Fundo (IA)
            </div>
          </div>
        )}

        {/* Precision Magnifier Loupe (Split-aware & calibrated to exact <img> pixels) */}
        {loupeEnabled && loupeState && cutoutUrl && (
          <div
            style={{
              width: `${LOUPE_SIZE}px`,
              height: `${LOUPE_SIZE}px`,
              left: `${loupeState.containerX - LOUPE_SIZE / 2}px`,
              top: `${loupeState.containerY - LOUPE_SIZE / 2}px`,
            }}
            className="pointer-events-none absolute z-30 rounded-full border-2 border-indigo-400 shadow-[0_8px_32px_rgba(0,0,0,0.75)] bg-checkerboard-dark overflow-hidden"
          >
            {/* Cutout Layer inside Loupe */}
            <div
              style={{
                backgroundImage: `url(${cutoutUrl})`,
                backgroundSize: `${loupeState.bgWidth}px ${loupeState.bgHeight}px`,
                backgroundPosition: `${loupeState.bgPosX}px ${loupeState.bgPosY}px`,
                backgroundRepeat: 'no-repeat',
                imageRendering: 'pixelated',
              }}
              className="absolute inset-0"
            />

            {/* Original Layer inside Loupe (clipped to match the exact Antes/Depois bar!) */}
            {loupeState.loupeSplitPct > 0 && (
              <div
                style={{
                  clipPath: `inset(0 ${100 - loupeState.loupeSplitPct}% 0 0)`,
                  backgroundImage: `url(${originalUrl})`,
                  backgroundSize: `${loupeState.bgWidth}px ${loupeState.bgHeight}px`,
                  backgroundPosition: `${loupeState.bgPosX}px ${loupeState.bgPosY}px`,
                  backgroundRepeat: 'no-repeat',
                  imageRendering: 'pixelated',
                }}
                className="absolute inset-0"
              />
            )}

            {/* Split divider line inside Loupe when crossing the bar */}
            {viewMode === 'split' &&
              loupeState.loupeSplitPct > 0 &&
              loupeState.loupeSplitPct < 100 && (
                <div
                  style={{ left: `${loupeState.loupeSplitPct}%` }}
                  className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow"
                />
              )}

            {/* Precision Crosshair at the exact center pixel */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-full h-px bg-indigo-400/45" />
              <div className="h-full w-px bg-indigo-400/45 absolute" />
              <div className="w-2.5 h-2.5 rounded-full border border-indigo-300/80 bg-transparent" />
            </div>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-slate-950/85 border border-slate-700/70 text-[10px] font-mono text-indigo-300 whitespace-nowrap">
              Lupa 4×
            </span>
          </div>
        )}

        {/* Bottom Floating Info Bar */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 text-xs text-slate-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-mono font-semibold text-white">
              {width} × {height} px
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-emerald-400 font-medium">100% Resolução Nativa Preservada</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 text-xs text-slate-400">
            <Move className="w-3.5 h-3.5 text-indigo-400" />
            <span>Role para Zoom • Arraste para mover</span>
          </div>
        </div>

        {/* AI Processing Overlay */}
        {isProcessing && (
          <div className="absolute inset-0 z-40 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="relative w-20 h-20 mb-5 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
              <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
              <span className="text-sm font-mono font-bold text-indigo-300">
                {progressPercent}%
              </span>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">{progressText}</h3>
            <p className="text-xs text-slate-400 max-w-md mb-4">
              A IA está separando o objeto principal e recompondo a máscara diretamente sobre os
              pixels originais sem perda de resolução.
            </p>
            <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div
                style={{ width: `${progressPercent}%` }}
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
