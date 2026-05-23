import { useEffect } from 'react';

// eslint-disable-next-line react/prop-types
function AdBanner({ slotId }) {
  useEffect(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      console.error('AdSense error:', e);
    }
  }, []);

  return (
    <div className="my-4 mx-auto flex flex-col justify-center items-center overflow-hidden min-h-[90px] w-full bg-slate-800/30 border border-slate-700/50 rounded-xl p-2">
      <span className="text-xs text-slate-500 mb-1">Sponsor Advertisement</span>
      <ins className="adsbygoogle"
           style={{ display: 'block', textAlignment: 'center' }}
           data-ad-client="ca-pub-5692275742295433"
           data-ad-slot={slotId}
           data-ad-format="horizontal"
           data-full-width-responsive="true">
      </ins>
    </div>
  );
}

export default AdBanner;
