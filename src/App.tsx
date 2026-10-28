import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  Sparkles,
  Download,
  Sliders,
  ShieldCheck,
  RefreshCw,
  ImagePlus,
  CheckCircle2,
  Cpu,
  Palette,
  Wand2,
  AlertCircle,
} from 'lucide-react';
import {
  EdgeRefinementOptions,
  BackdropOptions,
  ProcessedImageData,
  loadImageFullRes,
  extractHighResAlphaMask,
  renderRefinedCutout,
  exportFullResolutionImage,
  createHighResDemoImage,
} from './utils/imageProcessor';
import { ComparisonViewport, ViewportMode } from './components/ComparisonViewport';

const DEFAULT_REFINEMENT: EdgeRefinementOptions = {
  edgeShift: 0,
  edgeContrast: 10,
  feather: 0,
  decontaminate: true,
  preserveOriginalRgb: true,
};

const DEFAULT_BACKDROP: BackdropOptions = {
  type: 'transparent-dark',
  solidColor: '#ffffff',
  gradientFrom: '#312e81',
  gradientTo: '#be185d',
};

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI Model quality setting
  const [modelQuality, setModelQuality] = useState<'isnet_fp16' | 'isnet'>('isnet_fp16');

  // Image & Processing state
  const [processedData, setProcessedData] = useState<ProcessedImageData | null>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string>('');
  const [cutoutCanvas, setCutoutCanvas] = useState<HTMLCanvasElement | null>(null);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Viewport & Studio Controls
  const [viewMode, setViewMode] = useState<ViewportMode>('split');
  const [refinement, setRefinement] = useState<EdgeRefinementOptions>(DEFAULT_REFINEMENT);
  const [backdrop, setBackdrop] = useState<BackdropOptions>(DEFAULT_BACKDROP);

  // Export options
  const [exportFormat, setExportFormat] = useState<'image/png' | 'image/webp'>('image/png');
  const [includeBackdropInExport, setIncludeBackdropInExport] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // Process an uploaded or demo File
  const processFile = useCallback(
    async (file: File, selectedModel = modelQuality) => {
      setErrorMsg(null);
      setIsProcessing(true);
      setProgressText('Lendo pixels na resolução nativa...');
      setProgressPercent(2);

      try {
        const loaded = await loadImageFullRes(file, file.name);

        // Show original immediately while AI runs
        if (processedData?.originalUrl) {
          URL.revokeObjectURL(processedData.originalUrl);
        }

        const alphaMask = await extractHighResAlphaMask(
          file,
          loaded.width,
          loaded.height,
          selectedModel,
          (stage, pct) => {
            setProgressText(stage);
            setProgressPercent(pct);
          }
        );

        const newProcessed: ProcessedImageData = {
          width: loaded.width,
          height: loaded.height,
          originalImageData: loaded.imageData,
          rawAlphaChannel: alphaMask,
          originalUrl: loaded.objectUrl,
          fileName: loaded.fileName,
          originalSizeBytes: loaded.sizeBytes,
        };

        setProcessedData(newProcessed);
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : 'Ocorreu um erro durante a remoção de fundo.';
        setErrorMsg(message);
      } finally {
        setIsProcessing(false);
      }
    },
    [modelQuality, processedData?.originalUrl]
  );

  // Re-composite in real time whenever refinement options or mask view mode change
  useEffect(() => {
    if (!processedData) return;

    const result = renderRefinedCutout(
      processedData,
      refinement,
      viewMode === 'mask'
    );
    setCutoutUrl(result.cutoutDataUrl);
    setCutoutCanvas(result.canvas);
  }, [processedData, refinement, viewMode]);

  // Support Ctrl+V image paste anywhere
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            processFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [processFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
      e.target.value = '';
    }
  };

  const handleLoadDemo = async () => {
    try {
      setIsProcessing(true);
      setProgressText('Gerando imagem de teste Ultra-HD (1600×1200)...');
      setProgressPercent(5);
      const demoFile = await createHighResDemoImage();
      await processFile(demoFile);
    } catch (err) {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!cutoutCanvas || !processedData) return;

    // Make sure we export the actual cutout (not the B&W mask inspection view)
    const finalCanvas =
      viewMode === 'mask'
        ? renderRefinedCutout(processedData, refinement, false).canvas
        : cutoutCanvas;

    const blob = await exportFullResolutionImage(
      finalCanvas,
      backdrop,
      exportFormat,
      includeBackdropInExport
    );

    const ext = exportFormat === 'image/png' ? 'png' : 'webp';
    const baseName = processedData.fileName.replace(/\.[^/.]+$/, '');
    const downloadUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${baseName}-sem-fundo-${processedData.width}x${processedData.height}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Top Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  LuminaCut <span className="text-indigo-400">Pro</span>
                </h1>
                <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle2 className="w-3 h-3" />
                  Zero Perda de Resolução
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Remoção de fundo por IA com preservação de pixels RGB nativos
              </p>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2.5">
            {/* AI Precision Mode Selector */}
            <div className="hidden lg:flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-slate-400">Motor IA:</span>
              <select
                value={modelQuality}
                onChange={(e) =>
                  setModelQuality(e.target.value as 'isnet_fp16' | 'isnet')
                }
                className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="isnet_fp16" className="bg-slate-900">
                  IS-Net FP16 (Alta Precisão + Rápido)
                </option>
                <option value="isnet" className="bg-slate-900">
                  IS-Net 32-bit (Ultra Precisão Studio)
                </option>
              </select>
            </div>

            <div className="hidden xl:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>100% Local & Privado</span>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-indigo-600/25 transition-all"
            >
              <ImagePlus className="w-4 h-4" />
              <span>Nova Imagem</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {errorMsg && (
          <div className="mb-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-3 text-rose-200 text-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-xs underline hover:text-white"
            >
              Fechar
            </button>
          </div>
        )}

        {!processedData && !isProcessing ? (
          /* Empty State / Hero Upload Dropzone */
          <div className="max-w-3xl mx-auto my-8">
            <div className="text-center mb-8">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/25 mb-3">
                <Wand2 className="w-3.5 h-3.5" />
                Motor True-RGB Alpha • Qualidade Intacta
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-3">
                Remova o fundo mantendo{' '}
                <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  100% da qualidade original
                </span>
              </h2>
              <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
                Diferente de ferramentas comuns que comprimem ou reduzem sua foto, o LuminaCut
                aplica a máscara neural diretamente nos pixels originais sem perda de nitidez.
              </p>
            </div>

            {/* Drag and Drop Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFile(false);
                const file = e.dataTransfer.files?.[0];
                if (file) processFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`group relative cursor-pointer rounded-3xl border-2 border-dashed p-10 sm:p-14 text-center transition-all ${
                isDraggingFile
                  ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]'
                  : 'border-slate-800 hover:border-indigo-500/60 bg-slate-900/50 hover:bg-slate-900/80'
              }`}
            >
              <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-5 group-hover:scale-110 group-hover:bg-indigo-500/20 transition-all">
                <Upload className="w-9 h-9 text-indigo-400" />
              </div>

              <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
                Arraste e solte sua imagem aqui, ou clique para selecionar
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 mb-6">
                Suporta <strong className="text-slate-200">PNG, JPG, WebP</strong> em até 4K/8K •
                Você também pode colar com <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 font-mono text-xs">Ctrl+V</kbd>
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all"
                >
                  Escolher Imagem do Computador
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLoadDemo();
                  }}
                  className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm border border-slate-700 transition-all flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Testar com Imagem Demo Ultra-HD</span>
                </button>
              </div>
            </div>

            {/* Feature Pillars */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                <div className="text-indigo-400 font-semibold text-sm mb-1">
                  1. Pixels Originais Intactos
                </div>
                <p className="text-xs text-slate-400">
                  Os canais RGB originais não passam por recompressão neural — cada detalhe e
                  textura permanece 100% nítido.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                <div className="text-purple-400 font-semibold text-sm mb-1">
                  2. Descontaminação de Halo
                </div>
                <p className="text-xs text-slate-400">
                  Remove automaticamente o reflexo colorido do fundo antigo em bordas suaves e
                  fios de cabelo.
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80">
                <div className="text-emerald-400 font-semibold text-sm mb-1">
                  3. Zoom 800% & Slider Antes/Depois
                </div>
                <p className="text-xs text-slate-400">
                  Inspecione cada pixel com lupa 4×, zoom de alta precisão e comparador interativo
                  em tempo real.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Studio Workspace: Viewport + Control Sidebar */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left / Center Column: Interactive Comparison & Zoom Viewport */}
            <div className="lg:col-span-8 xl:col-span-9 flex flex-col">
              <ComparisonViewport
                originalUrl={processedData?.originalUrl || ''}
                cutoutUrl={cutoutUrl}
                width={processedData?.width || 0}
                height={processedData?.height || 0}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                backdrop={backdrop}
                isProcessing={isProcessing}
                progressText={progressText}
                progressPercent={progressPercent}
              />
            </div>

            {/* Right Column: Precision Edge Refinement & Lossless Export Panel */}
            <aside className="lg:col-span-4 xl:col-span-3 flex flex-col gap-5">
              {/* Card 1: Edge Refinement Controls */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-bold text-white">
                      Refinamento de Borda HD
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRefinement(DEFAULT_REFINEMENT)}
                    className="text-xs text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition-colors"
                    title="Restaurar padrões de borda"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Resetar</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Edge Shift (Choke / Spread) */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-300 font-medium">
                        Ajuste de Contorno (Contrair/Expandir)
                      </span>
                      <span className="font-mono text-indigo-300">
                        {refinement.edgeShift > 0
                          ? `+${refinement.edgeShift}`
                          : refinement.edgeShift}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={refinement.edgeShift}
                      onChange={(e) =>
                        setRefinement((prev) => ({
                          ...prev,
                          edgeShift: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                      <span>Remover Halo (-50)</span>
                      <span>Original (0)</span>
                      <span>Expandir (+50)</span>
                    </div>
                  </div>

                  {/* Edge Contrast */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-300 font-medium">
                        Nitidez de Transição Alfa
                      </span>
                      <span className="font-mono text-indigo-300">
                        {refinement.edgeContrast}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={refinement.edgeContrast}
                      onChange={(e) =>
                        setRefinement((prev) => ({
                          ...prev,
                          edgeContrast: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>

                  {/* Feathering */}
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-300 font-medium">
                        Suavização de Borda (Feather)
                      </span>
                      <span className="font-mono text-indigo-300">
                        {refinement.feather} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={1}
                      value={refinement.feather}
                      onChange={(e) =>
                        setRefinement((prev) => ({
                          ...prev,
                          feather: Number(e.target.value),
                        }))
                      }
                      className="w-full"
                    />
                  </div>

                  {/* Color Decontamination Toggle */}
                  <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={refinement.decontaminate}
                      onChange={(e) =>
                        setRefinement((prev) => ({
                          ...prev,
                          decontaminate: e.target.checked,
                        }))
                      }
                      className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Descontaminação de Cor nas Bordas
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                        Elimina halos coloridos do fundo original nas bordas semitransparentes.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Card 2: Backdrop Studio Preview */}
              <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                <div className="flex items-center gap-2 mb-3.5">
                  <Palette className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-bold text-white">Fundo de Estúdio</h2>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() =>
                      setBackdrop((prev) => ({ ...prev, type: 'transparent-dark' }))
                    }
                    className={`h-10 rounded-xl bg-checkerboard-dark border-2 transition-all ${
                      backdrop.type === 'transparent-dark'
                        ? 'border-indigo-500 scale-105'
                        : 'border-slate-700'
                    }`}
                    title="Transparente Escuro"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setBackdrop((prev) => ({ ...prev, type: 'transparent-light' }))
                    }
                    className={`h-10 rounded-xl bg-checkerboard-light border-2 transition-all ${
                      backdrop.type === 'transparent-light'
                        ? 'border-indigo-500 scale-105'
                        : 'border-slate-700'
                    }`}
                    title="Transparente Claro"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setBackdrop((prev) => ({
                        ...prev,
                        type: 'solid',
                        solidColor: '#ffffff',
                      }))
                    }
                    className={`h-10 rounded-xl bg-white border-2 transition-all ${
                      backdrop.type === 'solid' && backdrop.solidColor === '#ffffff'
                        ? 'border-indigo-500 scale-105'
                        : 'border-slate-700'
                    }`}
                    title="Fundo Branco Estúdio"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setBackdrop((prev) => ({ ...prev, type: 'gradient' }))
                    }
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${backdrop.gradientFrom}, ${backdrop.gradientTo})`,
                    }}
                    className={`h-10 rounded-xl border-2 transition-all ${
                      backdrop.type === 'gradient'
                        ? 'border-indigo-500 scale-105'
                        : 'border-slate-700'
                    }`}
                    title="Fundo Gradiente"
                  />
                </div>

                {/* Custom Solid Color Picker */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <span className="text-xs text-slate-400">Cor personalizada:</span>
                  <div className="flex items-center gap-1.5">
                    {['#0f172a', '#10b981', '#3b82f6', '#f43f5e', '#f59e0b'].map(
                      (hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() =>
                            setBackdrop((prev) => ({
                              ...prev,
                              type: 'solid',
                              solidColor: hex,
                            }))
                          }
                          style={{ backgroundColor: hex }}
                          className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                        />
                      )
                    )}
                    <input
                      type="color"
                      value={backdrop.solidColor}
                      onChange={(e) =>
                        setBackdrop((prev) => ({
                          ...prev,
                          type: 'solid',
                          solidColor: e.target.value,
                        }))
                      }
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                      title="Escolher qualquer cor"
                    />
                  </div>
                </div>
              </div>

              {/* Card 3: Lossless Ultra-HD Export */}
              <div className="p-5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-900/90 border border-indigo-500/30 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-white">
                    Exportação sem Perda
                  </h2>
                  {processedData && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      {processedData.width} × {processedData.height} px
                    </span>
                  )}
                </div>

                {/* Format Selection */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setExportFormat('image/png')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      exportFormat === 'image/png'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    PNG (100% Lossless)
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportFormat('image/webp')}
                    className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                      exportFormat === 'image/webp'
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    WebP (Ultra HD)
                  </button>
                </div>

                {(backdrop.type === 'solid' || backdrop.type === 'gradient') && (
                  <label className="flex items-center gap-2 text-xs text-slate-300 mb-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeBackdropInExport}
                      onChange={(e) => setIncludeBackdropInExport(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-indigo-600"
                    />
                    <span>Incluir cor/gradiente de fundo no arquivo salvo</span>
                  </label>
                )}

                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!cutoutCanvas || isProcessing}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Baixar em Resolução Original</span>
                </button>

                {processedData && (
                  <p className="text-[11px] text-slate-400 text-center mt-2.5">
                    Arquivo original: {formatBytes(processedData.originalSizeBytes)} •{' '}
                    <span className="text-emerald-400">Nitidez original mantida</span>
                  </p>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
export default App;

