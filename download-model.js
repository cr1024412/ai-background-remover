import { pipeline, env } from '@huggingface/transformers';

// 設定把模型強行下載到 public/models 資料夾中
env.allowLocalModels = false;
env.remoteHost = 'https://huggingface.co';
env.remotePathTemplate = '{model}/resolve/{revision}/';

async function download() {
  console.log('--- 🚀 開始下載 AI 去背模型 (約 45MB)，請稍候... ---');
  try {
    // 呼叫 pipeline 就會觸發下載，下載完會自動存入 Transformers.js 的預設快取
    await pipeline('image-segmentation', 'Xenova/rmbg-1.4');
    console.log('--- ✅ 模型下載成功！ ---');
  } catch (error) {
    console.error('❌ 下載失敗，錯誤原因:', error);
  }
}

download();