import { useEffect, useRef, useState } from 'react';
import { X, Volume2, VolumeX, ShoppingBag } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { AdReel } from './ReelsStrip';
import { useNavigate } from 'react-router-dom';

interface Props {
  reels: AdReel[];
  startIndex: number;
  onClose: () => void;
}

export const ReelsViewer = ({ reels, startIndex, onClose }: Props) => {
  const [muted, setMuted] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const navigate = useNavigate();
  const viewedRef = useRef<Set<string>>(new Set());

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Scroll to start index
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const child = el.children[startIndex] as HTMLElement | undefined;
    child?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [startIndex]);

  // Play visible video, pause others; track view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = Number((entry.target as HTMLElement).dataset.idx);
          const video = videoRefs.current[idx];
          if (!video) return;
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            video.play().catch(() => {});
            const reel = reels[idx];
            if (reel && !viewedRef.current.has(reel.id)) {
              viewedRef.current.add(reel.id);
              supabase.from('ad_reels').select('views_count').eq('id', reel.id).single().then(({ data }) => {
                if (data) {
                  void supabase.from('ad_reels').update({ views_count: (data.views_count ?? 0) + 1 }).eq('id', reel.id);
                }
              });
            }
          } else {
            video.pause();
          }
        });
      },
      { root: el, threshold: [0, 0.6, 1] }
    );
    Array.from(el.children).forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [reels]);

  const handleCta = (reel: AdReel) => {
    supabase.from('ad_reels').select('clicks_count').eq('id', reel.id).single().then(({ data }) => {
      if (data) supabase.from('ad_reels').update({ clicks_count: (data.clicks_count ?? 0) + 1 }).eq('id', reel.id);
    });
    if (reel.product_provider && reel.product_id) {
      onClose();
      navigate(`/product/${reel.product_provider}/${reel.product_id}`);
    } else if (reel.cta_url) {
      if (reel.cta_url.startsWith('http')) window.open(reel.cta_url, '_blank');
      else { onClose(); navigate(reel.cta_url); }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 bg-black/50 backdrop-blur-sm rounded-full p-2 text-white hover:bg-black/70"
        aria-label="Close"
      >
        <X className="w-6 h-6" />
      </button>
      <button
        onClick={() => setMuted((m) => !m)}
        className="absolute top-4 right-16 z-10 bg-black/50 backdrop-blur-sm rounded-full p-2 text-white hover:bg-black/70"
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>

      <div
        ref={containerRef}
        className="h-full w-full overflow-y-auto snap-y snap-mandatory scrollbar-hide"
      >
        {reels.map((reel, i) => (
          <div
            key={reel.id}
            data-idx={i}
            className="relative h-screen w-full snap-start flex items-center justify-center"
          >
            <video
              ref={(el) => { videoRefs.current[i] = el; }}
              src={reel.video_url}
              poster={reel.poster_url ?? undefined}
              className="h-full w-full object-contain bg-black"
              muted={muted}
              loop
              playsInline
              preload="metadata"
              onClick={(e) => {
                const v = e.currentTarget;
                if (v.paused) v.play(); else v.pause();
              }}
            />
            <div className="absolute bottom-0 left-0 right-0 p-4 pb-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white">
              <h3 className="font-bold text-lg mb-1">{reel.title}</h3>
              {reel.caption && <p className="text-sm opacity-90 mb-3 line-clamp-3">{reel.caption}</p>}
              {(reel.product_id || reel.cta_url) && (
                <button
                  onClick={() => handleCta(reel)}
                  className="inline-flex items-center gap-2 bg-white text-black font-semibold px-4 py-2 rounded-full text-sm hover:bg-white/90"
                >
                  <ShoppingBag className="w-4 h-4" />
                  {reel.cta_label || 'Shop now'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
