import { useEffect } from 'react';

// eslint-disable-next-line react/prop-types
function AdBanner({ slotId }) {
  useEffect(() => {
    try {
      if (
        window.adsbygoogle &&
        document.querySelector(`ins[data-ad-slot="${slotId}"]`)
      ) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (e) {
      console.error('AdSense error:', e);
    }
  }, [slotId]);

  return (
    <div className="my-4 mx-auto flex flex-col justify-center items-center overflow-hidden min-h-[120px] w-full bg-slate-800/30 border border-slate-700/50 rounded-xl p-2">
      
      <span className="text-xs text-slate-500 mb-2 tracking-wide uppercase">
        Sponsor Advertisement
      </span>

      <ins
        className="adsbygoogle"
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
        }}
        data-ad-client="ca-pub-5692275742295433"

        /*
          ⚠️ 這裡的 slotId 必須是 Google AdSense 後台建立廣告後給你的「數字 ID」
          
          正確範例：
          slotId="4839201948"

          ❌ 不可以：
          slotId="top-banner-ad"
        */

        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      ></ins>
    </div>
  );
}

export default AdBanner;