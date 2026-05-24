import { useState, useEffect, useRef } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
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

  // 取得當前選取的圖片物件
  const activeImage = images.find(img => img.id === activeImageId);

  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [processStep, setProcessStep] = useState('');
  const [processProgress, setProcessProgress] = useState(0);

  // 💎 修正：初始值改回 0 (在最左邊)
  const [sliderPos, setSliderPos] = useState(0);
  const [autoSlider, setAutoSlider] = useState(true);

  // 🖌️ 橡皮擦功能專用 State
  const [isEraserMode, setIsEraserMode] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [isDrawing, setIsDrawing] = useState(false);
  const eraserCanvasRef = useRef(null);

  const modelRef = useRef(null);
  const processorRef = useRef(null);
  const transformersRef = useRef(null);
  
  // 網址常數 (用於分享功能)
  const siteUrl = 'https://ai-background-remover-three.vercel.app/';

  // =========================
  // 切換圖片或完成去背時的邏輯
  // =========================
  useEffect(() => {
    setIsEraserMode(false);
    
    if (activeImage && activeImage.status === 'done') {
      setSliderPos(0); // 💎 修正：重新整理時從最左邊開始
      setAutoSlider(true);
    }
  }, [activeImageId, activeImage?.status]);

  // =========================
  // 總體進度計算
  // =========================
  const totalImages = images.length;
  const doneImagesCount = images.filter(img => img.status === 'done').length;
  const processingImagesCount = images.filter(img => img.status === 'processing').length;

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
  // 💎 60fps 滑順揭曉動畫 (Auto slider animation)
  // =========================
  useEffect(() => {
    if (!autoSlider || isEraserMode) return;
    
    const interval = setInterval(() => {
      setSliderPos(prev => {
        if (prev >= 100) { // 💎 修正：當滑桿到達 100 (最右邊) 時停止
          setAutoSlider(false);
          return 100;
        }
        return prev + 1.5; // 💎 修正：數字由小變大，達成由左往右滑
      });
    }, 16); 
    
    return () => clearInterval(interval);
  }, [autoSlider, isEraserMode]);

  // =========================
  // Init AI (啟用 Web Worker)
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
        env.backends.onnx.wasm.proxy = true; 
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
    setProcessStep('✨ AI 魔法燃燒算力中 (請稍候)...');
    await yieldToBrowser();

    const fakeProgressInterval = setInterval(() => {
      setProcessProgress(prev => {
        if (prev >= 78) {
          clearInterval(fakeProgressInterval);
          return prev;
        }
        return prev + 1;
      });
    }, 150);

    let output;
    try {
      output = await modelRef.current(modelInputs);
    } finally {
      clearInterval(fakeProgressInterval);
    }

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

      img.onload = async () => {
        try {
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;

          for (let y = 0; y < canvas.height; y++) {
            if (y % 50 === 0) await yieldToBrowser(1); 
            
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

      await new Promise(r => setTimeout(r, 300));

      try {
        const result = await runBackgroundRemoval(target.originalUrl);
        setImages(prev =>
          prev.map(img =>
            img.id === target.id ? { 
              ...img, 
              status: 'done', 
              processedUrl: result,
              aiProcessedUrl: result,      
              eraserHistory: [result]      
            } : img
          )
        );
      } catch (err) {
        console.error(err);
        setImages(prev =>
          prev.map(img =>
            img.id === target.id ? { ...img, status: 'error' } : img
          )
        );
      } finally {
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
      aiProcessedUrl: null,
      eraserHistory: [],
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

  const updateActiveBgColor = color => {
    setImages(prev =>
      prev.map(img =>
        img.id === activeImageId ? { ...img, bgColor: color } : img
      )
    );
  };

  const handleDownloadSingle = imageObj => {
    if (!imageObj || imageObj.status !== 'done') return;
    const link = document.createElement('a');
    link.href = imageObj.processedUrl;
    link.download = `AI-Removed-${imageObj.name}.png`;
    link.click();
  };

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
  // 🖌️ 橡皮擦 (Eraser) 邏輯區
  // =========================

  useEffect(() => {
    if (isEraserMode && activeImage && activeImage.status === 'done' && eraserCanvasRef.current) {
      const canvas = eraserCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = activeImage.processedUrl;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEraserMode, activeImage?.id]); 

  const startDrawing = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const canvas = eraserCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'destination-out'; 
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = eraserCanvasRef.current;
    const ctx = canvas.getContext('2d');

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = eraserCanvasRef.current;
    if (canvas && activeImage) {
      const newUrl = canvas.toDataURL('image/png');
      setImages(prev =>
        prev.map(img =>
          img.id === activeImage.id ? { 
            ...img, 
            processedUrl: newUrl,
            eraserHistory: [...(img.eraserHistory || []), newUrl]
          } : img
        )
      );
    }
  };

  const handleUndo = () => {
    if (!activeImage) return;

    setImages(prev => {
      const currentImg = prev.find(img => img.id === activeImage.id);
      if (!currentImg || !currentImg.eraserHistory || currentImg.eraserHistory.length <= 1) return prev;

      const newHistory = [...currentImg.eraserHistory];
      newHistory.pop(); 
      const previousUrl = newHistory[newHistory.length - 1]; 

      const canvas = eraserCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, canvas.width, canvas.height); 
          ctx.drawImage(img, 0, 0); 
        };
        img.src = previousUrl;
      }

      return prev.map(img =>
        img.id === activeImage.id ? { ...img, processedUrl: previousUrl, eraserHistory: newHistory } : img
      );
    });
  };

  const handleResetEraser = () => {
    if (!activeImage) return;

    setImages(prev => {
      const currentImg = prev.find(img => img.id === activeImage.id);
      if (!currentImg || !currentImg.aiProcessedUrl) return prev;

      const initialUrl = currentImg.aiProcessedUrl;

      const canvas = eraserCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, canvas.width, canvas.height); 
          ctx.drawImage(img, 0, 0); 
        };
        img.src = initialUrl;
      }

      return prev.map(img =>
        img.id === activeImage.id ? { 
          ...img, 
          processedUrl: initialUrl, 
          eraserHistory: [initialUrl] 
        } : img
      );
    });
  };

  const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${brushSize}" height="${brushSize}" viewBox="0 0 ${brushSize} ${brushSize}"><circle cx="${brushSize/2}" cy="${brushSize/2}" r="${brushSize/2 - 1}" fill="rgba(255,255,255,0.2)" stroke="white" stroke-width="2" style="filter: drop-shadow(0 0 1px black);"/></svg>`;
  const cursorUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(cursorSvg)}") ${brushSize/2} ${brushSize/2}, auto`;

  // =========================
  // 樣式常數
  // =========================
  const checkeredBackgroundStyle = {
    backgroundImage: 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
    backgroundSize: '20px 20px',
    backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
    backgroundColor: '#ffffff'
  };

  const getBackgroundStyle = (bgColor) => {
    if (bgColor === 'transparent') {
      return checkeredBackgroundStyle;
    } else if (bgColor && bgColor.startsWith('linear-gradient')) {
      return { background: bgColor };
    } else {
      return { backgroundColor: bgColor };
    }
  };

  // =========================
  // SEO Meta 標籤設定
  // =========================
  const seoTags = (
    <Helmet>
      <title>免費 AI 線上去背工具 | 一鍵自動照片去背、免登入精準去白底</title>
      <meta name="description" content="完全免費、免登入的 AI 線上去背神器！一鍵自動移除圖片背景、精準去白底，完美保留髮絲細節。適合電商商品照、證件照與社群頭貼優化，瀏覽器打開即用。" />
      <meta name="keywords" content="去背, 線上去背, AI去背, 免費去背, 照片去背, 去白底, 證件照去背, 證件照換底色, 電商產品圖去背, background remover, remove bg" />
      <link rel="canonical" href={siteUrl} />
      <meta property="og:title" content="免費 AI 線上去背工具 | 一鍵自動照片去背、免登入精準去白底" />
      <meta property="og:description" content="完全免費、一鍵自動移除圖片背景！精準去白底，完美保留髮絲細節，瀏覽器打開即用。" />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={siteUrl} />
    </Helmet>
  );

  // =========================
  // Mobile UI
  // =========================

  if (isMobile) {
    return (
      <HelmetProvider>
        {seoTags}
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
      </HelmetProvider>
    );
  }

  return (
    <HelmetProvider>
      {seoTags}
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-4 overflow-hidden">
        <div className="max-w-7xl w-full">
          
          <div className="w-full bg-slate-900/40 rounded-xl border border-slate-800/50 mb-4 overflow-hidden">
            <AdBanner slotId="top-banner-ad" />
          </div>

          <header className="text-center py-6">
            <h1 className="text-5xl md:text-6xl font-black bg-gradient-to-r from-cyan-400 via-emerald-400 to-blue-400 bg-clip-text text-transparent mb-4">
              ✨ AI 神級去背神器
            </h1>
            <p className="text-slate-300 text-base md:text-lg mb-6">
              不用 Photoshop，上傳多張圖片就能在背景默默去背 💖
            </p>

            <div className="flex flex-wrap justify-center gap-3 mb-8">
              <button 
                onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(siteUrl)}`, '_blank')}
                className="px-4 py-2 bg-[#1877F2]/20 border border-[#1877F2]/50 text-[#1877F2] hover:bg-[#1877F2] hover:text-white rounded-full font-bold text-sm transition-all shadow-lg flex items-center gap-2"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                分享到 FB
              </button>
              <button 
                onClick={() => window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(siteUrl)}`, '_blank')}
                className="px-4 py-2 bg-[#06C755]/20 border border-[#06C755]/50 text-[#06C755] hover:bg-[#06C755] hover:text-white rounded-full font-bold text-sm transition-all shadow-lg flex items-center gap-2"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 3.55 8.845 8.365 9.582.327.071.773.226.887.514.103.262.066.671.031.933-.04.303-.258 1.547-.314 1.828-.068.341.31.336.561.168.21-.137 1.957-1.42 2.682-1.983.3-.232.735-.411 1.258-.465h.005c.835.127 1.704.195 2.593.195 6.617 0 12-4.369 12-9.738zm-15.011 3.09c-.295 0-.533-.238-.533-.533v-3.921c0-.295.238-.533.533-.533s.533.238.533.533v3.388h2.326c.295 0 .533.238.533.533s-.238.533-.533.533h-2.86zm5.836 0c-.295 0-.533-.238-.533-.533v-3.921c0-.295.238-.533.533-.533s.533.238.533.533v3.921c0 .295-.238.533-.533.533zm3.766 0c-.295 0-.533-.238-.533-.533v-2.31l-2.072 2.709c-.066.086-.166.134-.27.134-.012 0-.024-.001-.036-.002-.116-.011-.219-.079-.272-.181-.052-.102-.057-.223-.012-.33l.01-.023v-2.852c0-.295.238-.533.533-.533s.533.238.533.533v2.31l2.072-2.709c.066-.086.166-.134.27-.134.012 0 .024.001.036.002.116.011.219.079.272.181.052.102.057.223.012.33l-.01.023v2.852c0 .295-.238.533-.533.533z"/></svg>
                分享到 LINE
              </button>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(siteUrl);
                  alert('🔗 連結已成功複製！快去貼到 IG 限動或其他地方分享吧！');
                }}
                className="px-4 py-2 bg-slate-700/50 border border-slate-600 text-slate-200 hover:bg-slate-600 hover:text-white rounded-full font-bold text-sm transition-all shadow-lg flex items-center gap-2"
              >
                📋 複製連結 (IG 分享)
              </button>
            </div>

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

          {isAllDone && (
            <div className="w-full bg-slate-900 border-2 border-emerald-500/30 rounded-3xl p-6 md:p-10 mb-8 shadow-[0_0_40px_rgba(52,211,153,0.15)] text-center transition-all">
              <h2 className="text-3xl md:text-4xl font-black text-emerald-400 mb-3">🎉 批次去背大功告成！</h2>
              <p className="text-slate-300 text-lg mb-6">所有圖片都已經處理完畢，請點擊下方按鈕打包帶走你的傑作。</p>
              
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

          {/* 🌟🌟🌟 Main Upload / Editor Area (核心功能區塊) 🌟🌟🌟 */}
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
                  <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center text-4xl mb-6">✨</div>
                  <h2 className="text-4xl font-black mb-3">把圖片丟進來吧！</h2>
                  <p className="text-slate-400 mb-8 text-lg">AI 會幫你自動去背～ 支援一次放多張超方便 💖</p>
                  <label className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:scale-105 transition-transform cursor-pointer font-bold text-lg shadow-2xl">
                    📂 選擇圖片
                    <input type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" />
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

                      {activeImage.status === 'done' && !isEraserMode && (
                        <div className="flex gap-2">
                          {backgroundTemplates.map(bg => (
                            <button
                              key={bg.name}
                              onClick={() => updateActiveBgColor(bg.value)}
                              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all hover:scale-105 ${
                                activeImage.bgColor === bg.value ? 'border-emerald-400 scale-105' : 'border-slate-700'
                              }`}
                              style={{ background: bg.value }}
                            >
                              <span className="mix-blend-difference text-white">{bg.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Preview Content */}
                    <div
                      className="flex-1 relative flex items-center justify-center overflow-hidden"
                      style={getBackgroundStyle(activeImage.bgColor)}
                    >
                      {activeImage.status === 'done' ? (
                        <div className="relative w-full h-full flex items-center justify-center">
                          
                          {/* 🖌️ 橡皮擦模式專屬 UI */}
                          {isEraserMode ? (
                            <>
                              <div className="absolute top-4 left-0 right-0 z-20 flex justify-center pointer-events-none">
                                <div className="bg-slate-900/90 backdrop-blur-md pointer-events-auto px-6 py-3 rounded-2xl border border-emerald-500/50 flex items-center gap-5 shadow-[0_0_20px_rgba(52,211,153,0.2)]">
                                  <span className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                                    <span className="animate-pulse">🔴</span> 橡皮擦模式中
                                  </span>
                                  <div className="h-6 w-px bg-slate-700"></div>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-slate-300 font-bold">筆刷</span>
                                    <input 
                                      type="range" min="5" max="150" value={brushSize} 
                                      onChange={(e) => setBrushSize(Number(e.target.value))}
                                      className="w-20 accent-emerald-400 cursor-ew-resize"
                                    />
                                  </div>
                                  <div className="h-6 w-px bg-slate-700"></div>
                                  
                                  {/* 一鍵還原按鈕 */}
                                  <button 
                                    onClick={handleResetEraser}
                                    disabled={!activeImage || !activeImage.eraserHistory || activeImage.eraserHistory.length <= 1}
                                    className={`px-3 py-1.5 text-sm font-bold rounded-lg transition-colors flex items-center gap-1 ${
                                      activeImage?.eraserHistory?.length > 1 
                                        ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/40 border border-rose-500/50' 
                                        : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
                                    }`}
                                    title="清除所有橡皮擦紀錄，回到 AI 初始狀態"
                                  >
                                    🔄 重置
                                  </button>

                                  {/* 復原按鈕 (Undo) */}
                                  <button 
                                    onClick={handleUndo}
                                    disabled={!activeImage || !activeImage.eraserHistory || activeImage.eraserHistory.length <= 1}
                                    className={`px-3 py-1.5 text-sm font-bold rounded-lg transition-colors flex items-center gap-1 ${
                                      activeImage?.eraserHistory?.length > 1 
                                        ? 'bg-slate-700 hover:bg-slate-600 text-white' 
                                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    }`}
                                  >
                                    ↩️ 復原
                                  </button>

                                  <div className="h-6 w-px bg-slate-700"></div>

                                  <button 
                                    onClick={() => setIsEraserMode(false)}
                                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-bold rounded-lg transition-colors"
                                  >
                                    ✅ 完成
                                  </button>
                                </div>
                              </div>
                              <canvas
                                ref={eraserCanvasRef}
                                onMouseDown={startDrawing}
                                onMouseMove={draw}
                                onMouseUp={stopDrawing}
                                onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing}
                                onTouchMove={draw}
                                onTouchEnd={stopDrawing}
                                className="absolute max-w-[90%] max-h-[90%] object-contain drop-shadow-2xl touch-none"
                                style={{ cursor: cursorUrl }}
                              />
                            </>
                          ) : (
                            /* 一般預覽模式 (含拖拉滑桿) */
                            <>
                              <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-sm text-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold pointer-events-none border border-slate-700 shadow-md">
                                ⬅️ 去背前 (原圖)
                              </div>
                              <div className="absolute top-4 right-4 z-10 bg-emerald-500/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-xl text-xs font-bold pointer-events-none shadow-lg">
                                去背後 (成果) ➡️
                              </div>

                              <div className="relative w-full h-full flex items-center justify-center">
                                {/* 底層：去背完成圖 (透明背景，After) */}
                                <img
                                  src={activeImage.processedUrl}
                                  className="absolute max-w-[90%] max-h-[90%] object-contain pointer-events-none"
                                  alt="去背後成果"
                                />
                                
                                {/* 上層 (被裁切)：原始圖 (有背景，Before) */}
                                <div
                                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                                  style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }} // 💎 修正：改成從左邊(Left)裁切
                                >
                                  <img
                                    src={activeImage.originalUrl}
                                    className="absolute max-w-[90%] max-h-[90%] object-contain pointer-events-none"
                                    alt="去背前原圖"
                                  />
                                </div>

                                {/* 滑桿線 */}
                                <div
                                  className="absolute inset-y-0 w-1 bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] pointer-events-none"
                                  style={{ left: `${sliderPos}%` }}
                                />

                                {/* 透明滑桿控制器 */}
                                <input
                                  type="range" min="0" max="100" value={sliderPos}
                                  onChange={e => {
                                    setAutoSlider(false);
                                    setSliderPos(e.target.value);
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-ew-resize z-20"
                                  title="拖曳以比較去背前後差異"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center p-6 w-full max-w-xl">
                          <img
                            src={activeImage.originalUrl}
                            className="max-w-[60%] max-h-[220px] object-contain opacity-40 rounded-xl mb-4"
                            alt={`等待處理圖片預覽 - ${activeImage.name}`}
                          />
                          
                          {activeImage.status === 'processing' && (
                            <div className="relative w-full max-w-sm bg-slate-900/95 p-6 rounded-3xl border border-slate-700/60 shadow-[0_0_40px_rgba(52,211,153,0.15)] flex flex-col items-center backdrop-blur-md overflow-hidden">
                              <div className="absolute -top-10 -left-10 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl"></div>
                              <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-cyan-500/20 rounded-full blur-3xl"></div>
                              <div className="relative w-16 h-16 flex items-center justify-center mb-4 z-10">
                                <div className="absolute inset-0 border-4 border-slate-800 rounded-full"></div>
                                <div className="absolute inset-0 border-4 border-emerald-400 border-t-transparent border-l-transparent rounded-full animate-spin"></div>
                                <div className="absolute inset-2 border-4 border-cyan-400 border-b-transparent border-r-transparent rounded-full animate-[spin_1.5s_linear_infinite_reverse]"></div>
                                <span className="text-2xl animate-pulse">✨</span>
                              </div>
                              <p className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 animate-pulse mb-5 z-10 text-center tracking-wide">
                                {processStep}
                              </p>
                              <div className="w-full z-10">
                                <div className="flex justify-between text-[11px] text-slate-400 font-bold mb-2 px-1">
                                  <span className="tracking-widest uppercase">Processing</span>
                                  <span className="text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.8)]">{processProgress}%</span>
                                </div>
                                <div className="w-full h-2.5 bg-slate-800/80 rounded-full overflow-hidden shadow-inner border border-slate-700/50">
                                  <div 
                                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 relative transition-all duration-300 ease-out"
                                    style={{ width: `${processProgress}%` }}
                                  >
                                    <div className="absolute top-0 bottom-0 right-0 w-20 bg-gradient-to-r from-transparent to-white/40"></div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {activeImage.status === 'pending' && (
                            <div className="text-center bg-slate-900/90 backdrop-blur-md px-6 py-3 rounded-xl border border-slate-600 text-slate-100 text-sm font-bold shadow-[0_0_15px_rgba(0,0,0,0.5)] tracking-wide">
                              ⏳ 排隊等待中...剩餘圖片處理完後會自動解鎖
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bottom Actions */}
                    {activeImage.status === 'done' && !isEraserMode && (
                      <div className="p-5 border-t border-slate-800 bg-slate-900/80 flex justify-center gap-4">
                        <button
                          onClick={() => setIsEraserMode(true)}
                          className="px-6 py-3 rounded-2xl bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-200 font-bold transition-all hover:scale-105 shadow-lg"
                        >
                          🖌️ 手動擦除 (橡皮擦)
                        </button>
                        <button
                          onClick={() => handleCopy(activeImage)}
                          className="px-6 py-3 rounded-2xl bg-slate-700 hover:bg-slate-600 font-bold transition-all hover:scale-105 shadow-lg"
                        >
                          📋 複製圖片
                        </button>
                        <button
                          onClick={() => handleDownloadSingle(activeImage)}
                          className="px-8 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 font-black hover:scale-105 transition-all shadow-xl"
                        >
                          ⬇️ 保存圖片
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
            {/* 🌟 廣告版位：批次處理等待區 */}
            {images.length > 0 && !isAllDone && (
              <div className="w-full bg-slate-900/40 rounded-2xl border border-slate-800/50 p-2 mb-2 overflow-hidden">
                <AdBanner slotId="processing-middle-ad" />
              </div>
            )}
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
                      alt="縮圖"
                    />
                    
                    {img.status === 'processing' && (
                      <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center backdrop-blur-[1px]">
                        <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mb-1.5" />
                        <span className="text-[11px] text-emerald-400 font-black drop-shadow-md tracking-wider">
                          {processProgress}%
                        </span>
                      </div>
                    )}
                    
                    {img.status === 'pending' && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-xs text-slate-400 font-bold">
                        ⏳ 等待
                      </div>
                    )}
                    {img.status === 'done' && (
                      <div className="absolute top-1 right-1 bg-emerald-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center shadow font-bold">✓</div>
                    )}
                  </div>
                ))}
                <label className="h-24 w-24 rounded-2xl border-2 border-dashed border-slate-600 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 transition-colors flex-shrink-0">
                  <div className="text-2xl">➕</div>
                  <div className="text-[11px] mt-1 text-slate-400">加入更多</div>
                  <input type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" />
                </label>
                
                {!isAllDone && (
                  <button onClick={handleDownloadAll} className="ml-auto px-6 py-4 rounded-2xl bg-gradient-to-r from-pink-500 to-orange-500 font-black hover:scale-105 transition-all shadow-2xl flex-shrink-0">
                    📦 打包下載
                  </button>
                )}
              </div>
            )}
          </main>
          {/* 🌟🌟🌟 核心功能區塊 結束 🌟🌟🌟 */}


          {/* 🌟🌟🌟 5 個 SEO Landing Page 區塊 (網格卡片設計) 🌟🌟🌟 */}
          <section className="w-full mt-16 mb-8 text-left relative z-10 flex flex-col gap-8">
            <div className="text-center mb-4">
              <h2 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-4 inline-block relative">
                ✨ AI 魔法去背，幫你解決所有煩惱
                <div className="absolute -bottom-2 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400/0 via-emerald-400/50 to-cyan-400/0"></div>
              </h2>
            </div>

            {/* 第一排：證件照 & 電商 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* SEO 1: 證件照 */}
              <div className="bg-slate-900/60 p-8 rounded-3xl border border-slate-700/80 hover:border-emerald-500/50 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(52,211,153,0.1)] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                <div className="text-4xl mb-5 drop-shadow-md">📸</div>
                <h3 className="text-2xl font-black text-slate-100 mb-4">證件照去背與換底色</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  自己在家拍大頭照，不用花錢去相館！透過我們的 AI 技術，一鍵完成<strong>證件照去背</strong>，並提供多種背景顏色模板，輕鬆實現<strong>證件照換底色</strong>（如藍底、白底、紅底）。
                </p>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> 護照、身份證白底輕鬆換</li>
                  <li className="flex items-center gap-2"><span className="text-emerald-500">✓</span> 履歷照、健保卡藍底一鍵搞定</li>
                </ul>
              </div>

              {/* SEO 2: 電商產品圖 */}
              <div className="bg-slate-900/60 p-8 rounded-3xl border border-slate-700/80 hover:border-cyan-500/50 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(6,182,212,0.1)] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                <div className="text-4xl mb-5 drop-shadow-md">🛍️</div>
                <h3 className="text-2xl font-black text-slate-100 mb-4">電商產品圖去背</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  網拍賣家必備神器！無論是服飾、美妝還是 3C 產品，快速進行<strong>電商產品圖去背</strong>與<strong>去白底</strong>。完美去除雜亂背景，讓商品凸顯焦點。
                </p>
                <ul className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-center gap-2"><span className="text-cyan-500">✓</span> 提升網店轉換率，專業度加分</li>
                  <li className="flex items-center gap-2"><span className="text-cyan-500">✓</span> 邊緣平滑處理，告別粗糙白邊</li>
                </ul>
              </div>
            </div>

            {/* 第二排：設計師與社群小編 (完美復刻截圖的視覺排版) */}
            <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 p-8 md:p-10 rounded-3xl border border-slate-700/80 hover:border-emerald-500/50 transition-all shadow-xl relative overflow-hidden group">
              <div className="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-emerald-500/20 transition-colors"></div>
              <h3 className="text-2xl md:text-3xl font-black text-slate-100 mb-4 relative z-10">🎨 釋放生產力：專為設計師與小編打造的去背神器</h3>
              <p className="text-slate-300 text-lg leading-relaxed mb-6 relative z-10">
                每天都要製作 YouTube 縮圖、IG 限動海報或 LINE 貼圖？別再浪費時間在 Photoshop 裡慢慢拉鋼筆工具了！
              </p>
              <ul className="space-y-4 text-slate-300 relative z-10">
                <li className="flex items-start gap-3">
                  <span className="text-emerald-500 font-bold mt-1">✓</span> 
                  <div><strong className="text-slate-200 block">極致 60fps 滑桿對比：</strong>圖片處理完成後，提供無比絲滑的「去背前後比較滑桿」，讓您一眼檢視去背品質。</div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-500 font-bold mt-1">✓</span> 
                  <div><strong className="text-slate-200 block">進階手動橡皮擦：</strong>若 AI 偶爾不小心切掉了需要的物件？隨時切換至「手動擦除」模式，自由調整筆刷修補細節。</div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-emerald-500 font-bold mt-1">✓</span> 
                  <div><strong className="text-slate-200 block">一鍵複製與打包：</strong>支援直接複製透明 PNG 至剪貼簿，也可在批次處理完畢後一鍵打包下載 ZIP 檔。</div>
                </li>
              </ul>
            </div>

            {/* 第三排：批次處理 & 完全免費 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* SEO 4: 批次處理 */}
              <div className="bg-slate-900/60 p-8 rounded-3xl border border-slate-700/80 hover:border-amber-500/50 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(245,158,11,0.1)] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                <div className="text-4xl mb-5 drop-shadow-md">⚡</div>
                <h3 className="text-2xl font-black text-slate-100 mb-4">全自動免費批次去背</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  手邊有幾十張活動照片需要處理？一張張弄絕對會崩潰。全選多張圖片拖曳進來，系統會自動排隊運算，完成後還能<strong>一鍵打包下載 ZIP</strong>，效率瞬間翻倍！
                </p>
              </div>

              {/* SEO 5: AI 去背神器 / 隱私安全 */}
              <div className="bg-slate-900/60 p-8 rounded-3xl border border-slate-700/80 hover:border-blue-500/50 transition-all shadow-lg hover:shadow-[0_0_30px_rgba(59,130,246,0.1)] relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-bl-full -z-10 group-hover:scale-110 transition-transform"></div>
                <div className="text-4xl mb-5 drop-shadow-md">🛡️</div>
                <h3 className="text-2xl font-black text-slate-100 mb-4">100% 免費、安全護隱私</h3>
                <p className="text-slate-300 leading-relaxed mb-4">
                  完全免費且<strong>免登入</strong>即可使用。我們採用最先進的 WebAssembly 前端運算技術，圖片只在你的瀏覽器中處理，<strong>絕對不會上傳到雲端伺服器</strong>，私密照片不怕外流！
                </p>
              </div>
            </div>
          </section>
          {/* 🌟🌟🌟 5 個 SEO Landing Page 區塊 結束 🌟🌟🌟 */}

          <div className="mt-8 w-full bg-slate-900/40 rounded-xl border border-slate-800/50 overflow-hidden">
            <AdBanner slotId="bottom-banner-ad" />
          </div>
        </div>
      </div>
    </HelmetProvider>
  );
}

export default App;