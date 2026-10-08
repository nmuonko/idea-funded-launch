import { useEffect, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';

export interface VipPhoto { url: string; colors?: string[] }
export function VipPhotoGallery({ photos, title, selectedColor }: { photos: VipPhoto[]; title: string; selectedColor?: string | null }) {
  const [api, setApi] = useState<CarouselApi>();
  const [active, setActive] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  useEffect(() => {
    if (!api) return;
    const update = () => setActive(api.selectedScrollSnap());
    update(); api.on('select', update);
    return () => { api.off('select', update); };
  }, [api]);
  useEffect(() => {
    if (!selectedColor) return;
    const index = photos.findIndex((p) => p.colors?.some((c) => c.toLowerCase() === selectedColor.toLowerCase()));
    if (index >= 0) api?.scrollTo(index);
  }, [selectedColor, api, photos]);
  const photo = photos[active] ?? photos[0];
  return <div className="min-w-0 space-y-3">
    <Carousel setApi={setApi} opts={{ loop: photos.length > 1, watchDrag: true, dragThreshold: 5 }} aria-label="Product photo gallery">
      <CarouselContent className="touch-pan-y select-none cursor-grab active:cursor-grabbing">
        {photos.map((p, index) => <CarouselItem key={`${p.url}-${index}`}>
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-vip-border bg-vip-surface-soft">
            <img src={p.url} alt={`${title} — ${index + 1}`} className="h-full w-full object-contain" draggable={false} />
            <Button size="icon" variant="secondary" className="absolute bottom-3 right-3" aria-label={`Zoom photo ${index + 1}`} title="Zoom photo" onClick={() => setZoomOpen(true)}><ZoomIn className="h-5 w-5" /></Button>
          </div>
        </CarouselItem>)}
      </CarouselContent>
      {photos.length > 1 && <><CarouselPrevious className="left-3" /><CarouselNext className="right-3" /></>}
    </Carousel>
    {photos.length > 1 && <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Photo thumbnails">
      {photos.map((p, index) => <Button key={`${p.url}-${index}`} variant="outline" className={`h-20 w-16 shrink-0 overflow-hidden rounded-md p-0 ${active === index ? 'ring-2 ring-primary' : ''}`} aria-label={`View photo ${index + 1}`} aria-pressed={active === index} onClick={() => api?.scrollTo(index)}>
        <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
      </Button>)}
    </div>}
    <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
      <DialogContent className="max-w-5xl w-[calc(100%-2rem)] p-3 pt-12" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <TransformWrapper key={photo?.url} minScale={1} maxScale={5} centerOnInit>
          {({ zoomIn, zoomOut, resetTransform }) => <>
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="icon" aria-label="Zoom in" title="Zoom in" onClick={() => zoomIn()}><ZoomIn className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" aria-label="Zoom out" title="Zoom out" onClick={() => zoomOut()}><ZoomOut className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" aria-label="Reset zoom" title="Reset zoom" onClick={() => resetTransform()}><RotateCcw className="h-4 w-4" /></Button>
            </div>
            <div className="flex h-[65vh] items-center justify-center overflow-hidden bg-vip-surface-soft">
              <TransformComponent wrapperClass="!h-full !w-full" contentClass="!h-full !w-full flex items-center justify-center">
                <img src={photo?.url} alt={title} className="h-full w-full object-contain" />
              </TransformComponent>
            </div>
          </>}
        </TransformWrapper>
      </DialogContent>
    </Dialog>
  </div>;
}