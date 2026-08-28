// /turkey-upload — private, token-gated, mobile-first upload page.
// Photos + article name + available sizes + final price → AI rewrites the copy
// and the item is published instantly on /turkey.
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Upload, ShieldCheck, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import logo from '@/assets/afrishop-logo.png';

type Lang = 'en' | 'fr';

const T = {
  en: {
    title: 'New article',
    subtitle: 'Private · publishes on the Turkey page',
    photos: 'Photos',
    addPhotos: 'Add photos',
    main: 'Main',
    name: 'Article name',
    namePh: 'e.g. Men slim fit wool blazer navy',
    sizes: 'Available sizes',
    sizesPh: 'e.g. 48, 50, 52 or S, M, L, XL',
    sizesHint: 'Separate with commas',
    price: 'Final price (USD)',
    pricePh: 'Price the customer pays',
    notes: 'Extra details (optional)',
    notesPh: 'Material, colour, fit… AI will write the description',
    aiNote: 'AI will rewrite the name and write a clean English description automatically.',
    submit: 'Publish on Turkey page',
    submitting: 'Publishing…',
    sent: 'Published ✅',
    sentDesc: 'The article is live on the Turkey page.',
    another: 'Add another article',
    needPhoto: 'Add at least one photo',
    needName: 'Enter the article name',
    needPrice: 'Enter a valid final price',
    error: 'Could not publish, try again',
  },
  fr: {
    title: 'Nouvel article',
    subtitle: 'Privé · publie sur la page Turquie',
    photos: 'Photos',
    addPhotos: 'Ajouter des photos',
    main: 'Principale',
    name: "Nom de l'article",
    namePh: 'ex: Blazer homme laine slim bleu marine',
    sizes: 'Tailles disponibles',
    sizesPh: 'ex: 48, 50, 52 ou S, M, L, XL',
    sizesHint: 'Séparez par des virgules',
    price: 'Prix final (USD)',
    pricePh: 'Prix que le client paie',
    notes: 'Détails supplémentaires (optionnel)',
    notesPh: "Matière, couleur, coupe… l'IA rédigera la description",
    aiNote: "L'IA réécrit le nom et rédige une description propre en anglais automatiquement.",
    submit: 'Publier sur la page Turquie',
    submitting: 'Publication…',
    sent: 'Publié ✅',
    sentDesc: "L'article est en ligne sur la page Turquie.",
    another: 'Ajouter un autre article',
    needPhoto: 'Ajoutez au moins une photo',
    needName: "Entrez le nom de l'article",
    needPrice: 'Entrez un prix final valide',
    error: 'Publication impossible, réessayez',
  },
};

const SHARED_TURKEY_TOKEN = 'TURKEY-AFRISHOP-2026';

async function compressImage(file: File, maxEdge = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

export default function TurkeyUpload() {
  const [params] = useSearchParams();
  const token = params.get('token') || SHARED_TURKEY_TOKEN;

  const [lang, setLang] = useState<Lang>('fr');
  const t = T[lang];

  const [images, setImages] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [sizes, setSizes] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 8 - images.length);
    for (const f of list) {
      try {
        const compressed = await compressImage(f);
        setImages((prev) => [...prev, compressed]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const submit = async () => {
    if (images.length === 0) return toast.error(t.needPhoto);
    if (!name.trim()) return toast.error(t.needName);
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return toast.error(t.needPrice);

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('turkey-upload-submit', {
        body: {
          name: name.trim(),
          price: p,
          sizes: sizes.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean),
          notes: notes.trim(),
          images,
        },
        headers: { 'x-turkey-token': token },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || 'failed');
      setDone(true);
      toast.success(t.sent);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message === 'invalid_token' ? 'Invalid link token' : t.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center mx-auto">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-semibold">{t.sent}</h1>
          <p className="text-sm text-muted-foreground">{t.sentDesc}</p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                setDone(false);
                setImages([]);
                setName('');
                setSizes('');
                setPrice('');
                setNotes('');
              }}
            >
              {t.another}
            </Button>
            <Button variant="outline" asChild>
              <a href="/turkey">/turkey</a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="px-4 py-3 flex items-center gap-3">
          <img src={logo} alt="AfriShop" className="h-9 w-auto" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">{t.title}</h1>
            <p className="text-[11px] text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex items-center rounded-md border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2.5 py-1.5 ${lang === 'en' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang('fr')}
              className={`px-2.5 py-1.5 ${lang === 'fr' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
            >
              FR
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-5">
        <section className="space-y-2">
          <Label>
            {t.photos} ({images.length}/8)
          </Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full h-14"
            disabled={images.length >= 8}
          >
            <Upload className="h-5 w-5 mr-2" /> {t.addPhotos}
          </Button>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden border">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                      {t.main}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <Label htmlFor="tu-name">{t.name}</Label>
          <Input id="tu-name" className="h-12" placeholder={t.namePh} value={name} onChange={(e) => setName(e.target.value)} />
        </section>

        <section className="space-y-1">
          <Label htmlFor="tu-sizes">{t.sizes}</Label>
          <Input id="tu-sizes" className="h-12" placeholder={t.sizesPh} value={sizes} onChange={(e) => setSizes(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{t.sizesHint}</p>
        </section>

        <section className="space-y-2">
          <Label htmlFor="tu-price">{t.price}</Label>
          <Input
            id="tu-price"
            type="number"
            inputMode="decimal"
            min={1}
            className="h-12"
            placeholder={t.pricePh}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </section>

        <section className="space-y-2">
          <Label htmlFor="tu-notes">{t.notes}</Label>
          <Textarea id="tu-notes" rows={3} placeholder={t.notesPh} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {t.aiNote}
          </p>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4">
        <div className="max-w-md mx-auto">
          <Button className="w-full h-13 h-12" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {submitting ? t.submitting : t.submit}
          </Button>
        </div>
      </div>
    </div>
  );
}
