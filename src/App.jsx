import { useState, useEffect, useRef } from 'react';
import AdBanner from './AdBanner';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const yieldToBrowser = (ms = 50) =>
  new Promise(resolve => setTimeout(resolve, ms));

function App() {
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    (navigator.platform === 'MacIntel' &&
      navigator.maxTouchPoints > 1);

  // =========================
  // State
  // =========================

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [isDragging, setIsDragging] = useState(false);

  const [images, setImages] = useState([]);
  const [activeImageId, setActiveImageId] = useState(null);

  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const [processStep, setProcessStep] = useState('');
  const [processProgress, setProcessProgress] = useState(0);

  const [sliderPos, setSliderPos] = useState(50);
  const [autoSlider, setAutoSlider] = useState(true);

  const modelRef = useRef(null);
  const processorRef = useRef(null);
  const transformersRef = useRef(null);

  // =========================
  // 總體進度計算
  // =========================
  const totalImages = images.length;
  const doneImagesCount = images.filter(img => img.status === 'done').length;
  const processingImagesCount = images.filter(img => img.status === 'processing').length;
  const pendingImagesCount = images.filter(img => img.status === 'pending').length;

  let overallProgress = 0;
  if (totalImages > 0) {
    const baseProgress = (doneImagesCount / totalImages) * 100;
    const currentItemProgress = processingImagesCount > 0 ? (processProgress / totalImages) : 0;
    overallProgress = Math.min(100, Math.round(baseProgress + currentItemProgress));
  }
  
  const isAllDone = totalImages > 0 && doneImagesCount === totalImages;

  // =========================
  // 漸層背景模板
  // =========================

  const backgroundTemplates = [
    { name: '透明', value: 'transparent', type: 'color' },
    { name: '奶油白', value: '#fffaf0', type: 'color' },
    { name: '天空藍', value: '#87ceeb', type: 'color' },
    { name: '櫻花粉', value: '#ffc0cb', type: 'color' },
    { name: '夜空黑', value: '#111827', type: 'color' },
    { name: '夢幻漸層', value: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)', type: 'gradient' },
    { name: 'IG 漸層', value: 'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)', type: 'gradient' },
  ];

  // =========================
  // Auto slider animation
  // =========================

  useEffect(() => {
    if (!autoSlider) return;
    const interval = setInterval(() => {
      setSliderPos(prev => {
        if (prev >= 100) return 0;
        return prev + 1;
      });
    }, 35);
    return () => clearInterval(interval);
  }, [autoSlider]);

  // =========================
  // Init AI
  // =========================

  useEffect(() => {
    if (isMobile) return;

    async function initAI() {
      try {
        const transformers = await import(
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3'
        );

        transformersRef.current = transformers;
        const { AutoModel, AutoImageProcessor, env } = transformers;

        env.allowRemoteModels = true;
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = 4;
        env.backends.onnx.wasm.proxy = false;
        env.backends.onnx.wasm.wasmPaths =
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/';

        const progressCallback = data => {
          if (data.status === 'progress' && data.progress !== undefined) {
            setDownloadProgress(Math.round(data.progress));
          }
        };

        processorRef.current = await AutoImageProcessor.from_pretrained(
          'briaai/RMBG-1.4',
          { progress_callback: progressCallback }
        );

        modelRef.current = await AutoModel.from_pretrained(
          'briaai/RMBG-1.4',
          {
            device: 'wasm',
            config: { model_type: 'segformer' },
            progress_callback: progressCallback,
          }
        );

        setReady(true);
      } catch (err) {
        console.error(err);
        setError(true);
        setErrorMsg(err.message || 'AI 魔法引擎載入失敗 😢');
      }
    }

    initAI();
  }, [isMobile]);

  // =========================
  // 去背核心
  // =========================

  const runBackgroundRemoval = async imgUrl => {
    setProcessProgress(10);
    setProcessStep('🧠 AI 正在分析圖片結構...');
    await yieldToBrowser();

    const { RawImage } = transformersRef.current;
    const rawImage = await RawImage.fromURL(imgUrl);
    const inputs = await processorRef.current(rawImage);

    const modelInputs = { input: inputs.pixel_values };

    setProcessProgress(45);
    setProcessStep('✨ AI 魔法去背施展中...');
    await yieldToBrowser();

    const output = await modelRef.current(modelInputs);

    setProcessProgress(80);
    setProcessStep('🎨 正在細緻化髮絲與邊緣...');
    await yieldToBrowser();

    const maskTensor = output.output || Object.values(output)[0];
    const maskData = maskTensor.data;
    const [_, __, maskHeight, maskWidth] = maskTensor.dims;

    const canvas = document.createElement('canvas');
    canvas.width = rawImage.width;
    canvas.height = rawImage.height;
    const ctx = canvas.getContext('2d');

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = imgUrl;

      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;

          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const imgIndex = (y * canvas.width + x) * 4;
              const maskX = Math.floor(x * (maskWidth / canvas.width));
              const maskY = Math.floor(y * (maskHeight / canvas.height));
              const maskIndex = maskY * maskWidth + maskX;

              let alphaValue = maskData[maskIndex] * 255;
              const smoothAlpha = Math.pow(alphaValue / 255, 1.15) * 255;
              data[imgIndex + 3] = Math.max(0, Math.min(255, smoothAlpha));
            }
          }

          ctx.putImageData(imgData, 0, 0);
          setProcessProgress(100);
          setProcessStep('🎉 本張去背完成！');
          resolve(canvas.toDataURL());
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = reject;
    });
  };

  // =========================
  // Queue (自動處理序列)
  // =========================

  useEffect(() => {
    const processNextInQueue = async () => {
      if (isProcessingQueue || !ready) return;

      const nextIndex = images.findIndex(img => img.status === 'pending');
      if (nextIndex === -1) return;

      setIsProcessingQueue(true);
      const target = images[nextIndex];

      setImages(prev =>
        prev.map(img =>
          img.id === target.id ? { ...img, status: 'processing' } : img
        )
      );

      try {
        const result = await runBackgroundRemoval(target.originalUrl);
        setImages(prev =>
          prev.map(img =>
            img.id === target.id ? { ...img, status: 'done', processedUrl: result } : img
          )
        );
      } catch (err) {
        console.error(err);
        setImages(prev =>
          prev.map(img =>
            img.id === target.id ? { ...img, status: 'error' } : img
          )
        );
      } {
        setIsProcessingQueue(false);
        setProcessProgress(0); 
      }
    };

    processNextInQueue();
  }, [images, ready, isProcessingQueue]);

  // =========================
  // Handle upload
  // =========================

  const handleFiles = fileList => {
    if (!fileList) return;

    const validFiles = Array.from(fileList).filter(file => file.type.startsWith('image/'));
    if (validFiles.length === 0) {
      alert('請上傳圖片唷 💖');
      return;
    }

    const newImages = validFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 11),
      file,
      originalUrl: URL.createObjectURL(file),
      processedUrl: null,
      status: 'pending',
      name: file.name,
      bgColor: 'transparent',
    }));

    setImages(prev => {
      const updated = [...prev, ...newImages];
      if (!activeImageId && updated.length > 0) {
        setActiveImageId(updated[0].id);
      }
      return updated;
    });
  };

  const handleFileChange = e => handleFiles(e.target.files);

  const handleDrop = e => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = e => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = e => {
    e.preventDefault();
    setIsDragging(false);
  };

  // =========================
  // 背景更新
  // =========================

  const updateActiveBgColor = color => {
    setImages(prev =>
      prev.map(img =>
        img.id === activeImageId ? { ...img, bgColor: color } : img
      )
    );
  };

  // =========================
  // 單張下載
  // =========================

  const handleDownloadSingle = imageObj => {
    if (!imageObj || imageObj.status !== 'done') return;
    const link = document.createElement('a');
    link.href = imageObj.processedUrl;
    link.download = `AI-Removed-${imageObj.name}.png`;
    link.click();
  };

  // =========================
  // ZIP 下載
  // =========================

  const handleDownloadAll = async () => {
    const doneImages = images.filter(img => img.status === 'done');
    if (doneImages.length === 0) {
      alert('目前沒有可下載圖片 😢');
      return;
    }
    const zip = new JSZip();
    for (const img of doneImages) {
      const response = await fetch(img.processedUrl);
      const blob = await response.blob();
      zip.file(`removed-${img.name}.png`, blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'AI-Background-Removed.zip');
  };

  // =========================
  // Copy
  // =========================

  const handleCopy = async imageObj => {
    try {
      const response = await fetch(imageObj.processedUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      alert('✨ 已成功複製圖片！');
    } catch {
      alert('❌ 複製失敗');
    }
  };

  // =========================
  // 透明背景斜線底圖案 (Checkerboard) 
  // =========================
  const checkeredBackgroundStyle = {
    backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
    backgroundColor: '#ffffff'
  };

  // =========================
  // 決定預覽背景樣式
  // =========================
  const getBackgroundStyle = (bgColor) => {
    if (bgColor === 'transparent') {
      return checkeredBackgroundStyle;
    } else if (bgColor && bgColor.startsWith('linear-gradient')) {
      return { background: bgColor };
    } else {
      return { backgroundColor: bgColor };
    }
  };

  const activeImage = images.find(img => img.id === activeImageId);

  // =========================
  // Mobile UI
  // =========================

  if (isMobile) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700 max-w-md text-center">
          <div className="text-6xl mb-5">📱</div>
          <h1 className="text-3xl font-bold text-emerald-400 mb-4">
            手機版努力優化中～
          </h1>
          <p className="text-slate-300 leading-relaxed">
            目前 AI 去背需要較大的運算空間，<br />
            建議使用電腦開啟效果更棒唷 ✨
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-4 overflow-hidden">
      <div className="max-w-7xl w-full">
        
        {/* 🌟 廣告版位：頂部橫幅 */}
        <div className="w-full bg-slate-900/40 rounded-xl border border-slate-800/50 mb-4 overflow-hidden">
          <AdBanner slotId="top-banner-ad" />
        </div>

        {/* Header */}
        <header className="text-center py-6">
          <h1 className="text-5xl md:text-6xl font-black bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-400 bg-clip-text text-transparent mb-4">
            ✨ AI 神級去背神器
          </h1>
          <p className="text-slate-300 text-base md:text-lg mb-6">
            不用 Photoshop，上傳多張圖片就能在背景默默去背 💖
          </p>

          {!ready && !error && (
            <div className="mt-6 max-w-md mx-auto bg-slate-800/70 p-5 rounded-2xl border border-slate-700">
              <p className="text-emerald-400 mb-3 font-bold animate-pulse">
                🧠 AI 魔法師準備中...
              </p>
              <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 bg-red-900/30 border border-red-700 rounded-2xl p-5 max-w-md mx-auto">
              ❌ {errorMsg}
            </div>
          )}
        </header>

        {/* ⏳ 全部去背時間進度條 (僅在處理中顯示) */}
        {totalImages > 0 && !isAllDone && (
          <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 mb-4 shadow-2xl transition-all">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="font-bold text-sm text-slate-200">⏳ 批次去背總進度</span>
              </div>
              <span className="text-xs bg-slate-800 px-2.5 py-1 rounded-md text-emerald-400 font-mono font-bold">
                已完成 {doneImagesCount} / 共 {totalImages} 張 ({overallProgress}%)
              </span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-500 transition-all duration-300 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* 🎉 任務完成超巨型廣告看板 (全部完成時彈出) */}
        {isAllDone && (
          <div className="w-full bg-slate-900 border-2 border-emerald-500/30 rounded-3xl p-6 md:p-10 mb-8 shadow-[0_0_40px_rgba(52,211,153,0.15)] text-center transition-all">
            <h2 className="text-3xl md:text-4xl font-black text-emerald-400 mb-3">🎉 批次去背大功告成！</h2>
            <p className="text-slate-300 text-lg mb-6">所有圖片都已經處理完畢，請點擊下方按鈕打包帶走你的傑作。</p>
            
            {/* 🌟 廣告版位：超級放大版廣告專區 */}
            <div className="w-full bg-slate-950/80 rounded-2xl border border-slate-700/50 p-2 md:p-6 mb-8 min-h-[320px] flex flex-col items-center justify-center relative overflow-hidden group hover:border-slate-600 transition-colors">
              <div className="absolute top-3 left-4 text-[10px] text-slate-500 font-black tracking-widest uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                Sponsor Advertisement
              </div>
              <div className="w-full h-full flex items-center justify-center mt-6">
                <AdBanner slotId="all-done-massive-ad" />
              </div>
            </div>
            
            <button
              onClick={handleDownloadAll}
              className="px-10 py-5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 font-black text-xl hover:scale-105 hover:shadow-[0_0_30px_rgba(52,211,153,0.4)] transition-all transform shadow-2xl w-full md:w-auto"
            >
              📦 立即打包下載全部 ({totalImages} 張)
            </button>
          </div>
        )}

        {/* Main Upload / Editor Area */}
        <main className="flex flex-col gap-6">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative min-h-[520px] rounded-3xl border-2 transition-all overflow-hidden ${
              isDragging
                ? 'border-emerald-400 bg-emerald-500/10 scale-[1.01]'
                : 'border-slate-700 bg-slate-900/60'
            }`}
          >
            {images.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center text-4xl mb-6">
                  ✨
                </div>
                <h2 className="text-4xl font-black mb-3">把圖片丟進來吧！</h2>
                <p className="text-slate-400 mb-8 text-lg">
                  AI 會幫你自動去背～ 支援一次放多張超方便 💖
                </p>
                <label className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:scale-105 transition-transform cursor-pointer font-bold text-lg shadow-2xl">
                  📂 選擇圖片
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            ) : (
              activeImage && (
                <div className="absolute inset-0 flex flex-col">
                  {/* Top Bar */}
                  <div className="h-16 border-b border-slate-800 bg-slate-900/70 flex items-center justify-between px-5">
                    <div className="flex items-center gap-3">
                      <span className="bg-slate-800 px-4 py-2 rounded-xl text-sm truncate max-w-[220px]">
                        {activeImage.name}
                      </span>
                      {activeImage.status === 'processing' && (
                        <span className="text-emerald-400 animate-pulse font-bold">
                          ✨ 處理中...{processProgress}%
                        </span>
                      )}
                    </div>

                    {activeImage.status === 'done' && (
                      <div className="flex gap-2">
                        {backgroundTemplates.map(bg => (
                          <button
                            key={bg.name}
                            onClick={() => updateActiveBgColor(bg.value)}
                            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all hover:scale-105 ${
                              activeImage.bgColor === bg.value
                                ? 'border-emerald-400 scale-105'
                                : 'border-slate-700'
                            }`}
                            style={{ background: bg.value }}
                          >
                            <span className="mix-blend-difference text-white">
                              {bg.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preview Content */}
                  {/* 🛠️ 修改：應用 getBackgroundStyle 函數 */}
                  <div
                    className="flex-1 relative flex items-center justify-center overflow-hidden"
                    style={getBackgroundStyle(activeImage.bgColor)}
                  >
                    {activeImage.status === 'done' ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        
                        {/* ⬅️ 去背前後文字標註 */}
                        <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-sm text-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold pointer-events-none border border-slate-700 shadow-md">
                          ⬅️ 去背前 (原圖)
                        </div>
                        <div className="absolute top-4 right-4 z-10 bg-emerald-500/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-xl text-xs font-bold pointer-events-none shadow-lg">
                          去背後 (成果) ➡️
                        </div>

                        <img
                          src={activeImage.processedUrl}
                          className="absolute max-w-[90%] max-h-[90%] object-contain drop-shadow-2xl"
                        />
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          style={{
                            clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                          }}
                        >
                          <img
                            src={activeImage.originalUrl}
                            className="absolute max-w-[90%] max-h-[90%] object-contain"
                          />
                        </div>
                        <div
                          className="absolute inset-y-0 w-1 bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                          style={{ left: `${sliderPos}%` }}
                        />
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={sliderPos}
                          onChange={e => {
                            setAutoSlider(false);
                            setSliderPos(e.target.value);
                          }}
                          className="absolute inset-0 opacity-0 cursor-ew-resize"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 w-full max-w-xl">
                        <img
                          src={activeImage.originalUrl}
                          className="max-w-[60%] max-h-[220px] object-contain opacity-40 rounded-xl mb-4"
                        />
                        
                        {activeImage.status === 'processing' && (
                          <div className="text-center w-full bg-slate-950/80 p-5 rounded-2xl border border-slate-800 shadow-inner flex flex-col items-center">
                            <div className="w-12 h-12 border-4 border-slate-800 border-t-emerald-400 rounded-full animate-spin mb-3" />
                            <p className="text-lg font-bold text-emerald-400 animate-pulse">
                              {processStep} ({processProgress}%)
                            </p>
                          </div>
                        )}
                        
                        {activeImage.status === 'pending' && (
                          <div className="text-center bg-slate-950/40 px-6 py-3 rounded-xl border border-slate-800 text-slate-400 text-sm">
                            ⏳ 排隊等待中...剩餘圖片處理完後會自動解鎖
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Bottom Actions */}
                  {activeImage.status === 'done' && (
                    <div className="p-5 border-t border-slate-800 bg-slate-900/80 flex justify-center gap-4">
                      <button
                        onClick={() => handleCopy(activeImage)}
                        className="px-6 py-3 rounded-2xl bg-slate-700 hover:bg-slate-600 font-bold transition-all hover:scale-105"
                      >
                        📋 複製圖片
                      </button>
                      <button
                        onClick={() => handleDownloadSingle(activeImage)}
                        className="px-8 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 font-black hover:scale-105 transition-all shadow-2xl"
                      >
                        ⬇️ 保存圖片
                      </button>
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          {/* Bottom Gallery Grid */}
          {images.length > 0 && (
            <div className="bg-slate-900/70 border border-slate-700 rounded-3xl p-4 overflow-x-auto flex gap-4 items-center">
              {images.map(img => (
                <div
                  key={img.id}
                  onClick={() => setActiveImageId(img.id)}
                  className={`relative h-24 w-24 rounded-2xl overflow-hidden cursor-pointer border-2 transition-all flex-shrink-0 ${
                    activeImageId === img.id
                      ? 'border-emerald-400 scale-105 shadow-[0_0_15px_rgba(52,211,153,0.3)]'
                      : 'border-slate-700 opacity-80 hover:opacity-100'
                  }`}
                >
                  <img
                    src={img.status === 'done' ? img.processedUrl : img.originalUrl}
                    className="w-full h-full object-cover"
                  />
                  {img.status === 'processing' && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {img.status === 'pending' && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-xs text-slate-400">
                      ⏳ 等待
                    </div>
                  )}
                  {img.status === 'done' && (
                    <div className="absolute top-1 right-1 bg-emerald-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center shadow">
                      ✓
                    </div>
                  )}
                </div>
              ))}
              <label className="h-24 w-24 rounded-2xl border-2 border-dashed border-slate-600 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors flex-shrink-0">
                <div className="text-2xl">➕</div>
                <div className="text-[11px] mt-1 text-slate-400">加入更多</div>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              
              {!isAllDone && (
                <button
                  onClick={handleDownloadAll}
                  className="ml-auto px-6 py-4 rounded-2xl bg-gradient-to-r from-pink-500 to-orange-500 font-black hover:scale-105 transition-all shadow-2xl flex-shrink-0"
                >
                  📦 打包下載
                </button>
              )}
            </div>
          )}
        </main>

        {/* 🌟 廣告版位：網頁底部壓軸橫幅 */}
        <div className="mt-8 w-full bg-slate-900/40 rounded-xl border border-slate-800/50 overflow-hidden">
          <AdBanner slotId="bottom-banner-ad" />
        </div>
      </div>
    </div>
  );
}

export default App;
