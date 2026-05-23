import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

let pipe = null;

self.addEventListener('message', async (event) => {
    const { image } = event.data;
    if (!image) return;

    try {
        if (!pipe) {
            self.postMessage({ status: 'initiate' });
            pipe = await pipeline('image-segmentation', 'Xenova/rmbg-1.4');
            self.postMessage({ status: 'ready' });
        }

        const output = await pipe(image);
        
        self.postMessage({ 
            status: 'done', 
            output: output.toCanvas().toDataURL() 
        });

    } catch (error) {
        console.error("Worker 運算失敗:", error);
        self.postMessage({ status: 'error', error: error.message });
    }
});
