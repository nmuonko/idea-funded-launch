import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Play } from 'lucide-react';
import { ReelsViewer } from './ReelsViewer';
import { useLanguage } from '@/contexts/LanguageContext';

export interface AdReel {
  id: string;
  title: string;
  caption: string | null;
  video_url: string;
  poster_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  product_provider: string | null;
  product_id: string | null;
}

export const ReelsStrip = () => {
  const [reels, setReels] = useState<AdReel[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { language } = useLanguage();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('ad_reels')
        .select('id,title,caption,video_url,poster_url,cta_label,cta_url,product_provider,product_id')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(20);
      if (!cancelled && !error && data) setReels(data as AdReel[]);
    })();
    return () => { cancelled = true; };
  }, []);

  if (reels.length === 0) return null;

  return (
    <section className="bg-white py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-black">
            {language === 'fr' ? 'Reels' : 'Reels'}
          </h2>
        </div>
        <div className="flex gap-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scrollbar-hide">
          {reels.map((r, i) => (
            <button
              key={r.id}
              onClick={() => setOpenIndex(i)}
              className="relative flex-shrink-0 w-32 h-52 sm:w-36 sm:h-60 rounded-xl overflow-hidden bg-black snap-start group ring-1 ring-black/5 hover:ring-primary/40 transition"
            >
              {r.poster_url ? (
                <img
                  src={r.poster_url}
                  alt={r.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <video
                  src={r.video_url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-sm rounded-full p-1.5">
                <Play className="w-3 h-3 text-white fill-white" />
              </div>
              <div className="absolute bottom-2 left-2 right-2 text-left">
                <p className="text-white text-xs font-semibold line-clamp-2 drop-shadow">
                  {r.title}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
      {openIndex !== null && (
        <ReelsViewer
          reels={reels}
          startIndex={openIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </section>
  );
};
