// /dubai-upload — private, token-gated, mobile-first product upload page.
import { useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Camera, Sparkles, Upload, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import logo from '@/assets/afrishop-logo.png';

type Lang = 'en' | 'fr';

const T = {
  en: {
    title: 'Dubai — New Product',
    subtitle: 'Private · Dubai supplier only',
    photos: 'Photos',
    addPhotos: 'Add photos',
    main: 'Main',
    category: 'Category',
    model: 'Model',
    chooseModel: 'Choose model',
    phoneName: 'Phone name',
    phonePlaceholder: 'e.g. iphone14promax 256 blue',
    improveTitle: 'Improve title (AI)',
    storage: 'Storage',
    color: 'Color',
    condition: 'Condition',
    battery: 'Battery (%)',
    sim: 'SIM',
    network: 'Network',
    faceId: 'Face ID',
    pricesHint: 'Prices (internal except final customer price)',
    aed: 'Dubai purchase (AED)',
    usd: 'Purchase (USD)',
    finalUsd: 'Final customer price (USD)',
    finalUsdPh: 'Leave empty for admin suggestion',
    notes: 'Supplier notes (internal)',
    publicDesc: 'Public description (optional)',
    submit: 'Submit',
    submitting: 'Submitting...',
    sent: 'Sent ✅',
    sentDesc: 'Product pending review by AfriShop admin.',
    sendAnother: 'Submit another product',
    addOnePhoto: 'Add at least one photo',
    sendError: 'Submission error',
    titleImproved: 'Title improved',
    aiError: 'AI error, try again',
    categories: { iphone: 'iPhone', samsung: 'Samsung', pixel: 'Google Pixel', other_phone: 'Other Phone', laptop: 'Laptop', accessories: 'Accessories', other: 'Other' },
  },
  fr: {
    title: 'Dubai — Nouveau produit',
    subtitle: 'Privé · Dubai supplier only',
    photos: 'Photos',
    addPhotos: 'Ajouter des photos',
    main: 'Principale',
    category: 'Catégorie',
    model: 'Modèle',
    chooseModel: 'Choisir le modèle',
    phoneName: 'Nom du téléphone',
    phonePlaceholder: 'ex: iphone14promax 256 blue',
    improveTitle: 'Améliorer le titre (IA)',
    storage: 'Stockage',
    color: 'Couleur',
    condition: 'État',
    battery: 'Batterie (%)',
    sim: 'SIM',
    network: 'Réseau',
    faceId: 'Face ID',
    pricesHint: 'Prix (interne sauf prix client final)',
    aed: 'Achat Dubai (AED)',
    usd: 'Achat (USD)',
    finalUsd: 'Prix final client (USD)',
    finalUsdPh: 'Laisser vide pour suggestion admin',
    notes: 'Notes fournisseur (interne)',
    publicDesc: 'Description publique (optionnel)',
    submit: 'Envoyer',
    submitting: 'Envoi...',
    sent: 'Envoyé ✅',
    sentDesc: 'Produit en attente de révision par l’admin AfriShop.',
    sendAnother: 'Envoyer un autre produit',
    addOnePhoto: 'Ajoutez au moins une photo',
    sendError: 'Erreur lors de l\'envoi',
    titleImproved: 'Titre amélioré',
    aiError: 'Erreur IA, réessayez',
    categories: { iphone: 'iPhone', samsung: 'Samsung', pixel: 'Google Pixel', other_phone: 'Autre téléphone', laptop: 'Ordinateur portable', accessories: 'Accessoires', other: 'Autre' },
  },
};

const CATEGORY_KEYS = ['iphone','samsung','pixel','other_phone','laptop','accessories','other'] as const;

const IPHONE_MODELS = [
  'iPhone XR','iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max',
  'iPhone 12','iPhone 12 Mini','iPhone 12 Pro','iPhone 12 Pro Max',
  'iPhone 13','iPhone 13 Mini','iPhone 13 Pro','iPhone 13 Pro Max',
  'iPhone 14','iPhone 14 Plus','iPhone 14 Pro','iPhone 14 Pro Max',
  'iPhone 15','iPhone 15 Plus','iPhone 15 Pro','iPhone 15 Pro Max',
  'iPhone 16','iPhone 16 Plus','iPhone 16 Pro','iPhone 16 Pro Max',
  'Other iPhone',
];
const SAMSUNG_MODELS = [
  'Samsung S20','Samsung S20 Ultra','Samsung S21','Samsung S21 Ultra',
  'Samsung S22','Samsung S22 Ultra','Samsung S23','Samsung S23 Ultra',
  'Samsung S24','Samsung S24 Ultra','Samsung Note 20','Samsung Note 20 Ultra',
  'Samsung A14','Samsung A15','Samsung A24','Samsung A25','Samsung A34',
  'Samsung A35','Samsung A54','Samsung A55','Other Samsung',
];
const PIXEL_MODELS = [
  'Google Pixel 6','Google Pixel 6 Pro','Google Pixel 7','Google Pixel 7 Pro',
  'Google Pixel 8','Google Pixel 8 Pro','Google Pixel 9','Google Pixel 9 Pro','Other Pixel',
];
const STORAGE_OPTS = ['64GB','128GB','256GB','512GB','1TB','Other'];
const CONDITION_OPTS = ['Brand New','Like New','Grade A','Grade B','Grade C'];
const SIM_OPTS = ['1 SIM','2 SIM','eSIM','Physical SIM + eSIM','Unknown'];
const NETWORK_OPTS = ['Unlocked','Locked','Unknown'];
const FACEID_OPTS = ['Working','Not working','Unknown'];

async function compressImage(file: File, maxEdge = 1600, quality = 0.8): Promise<string> {
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
        canvas.width = width; canvas.height = height;
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Shared fallback token — embedded so the /dubai link always works for the on-site buyer.
const SHARED_DUBAI_TOKEN = 'DUBAI-AFRISHOP-2026';

export default function DubaiUpload() {
  const [params] = useSearchParams();
  const token = params.get('token') || SHARED_DUBAI_TOKEN;

  const [lang, setLang] = useState<Lang>('en');
  const t = T[lang];

  // form
  const [category, setCategory] = useState('iphone');
  const [model, setModel] = useState('');
  const [modelOther, setModelOther] = useState('');
  const [refinedTitle, setRefinedTitle] = useState('');
  const [refining, setRefining] = useState(false);

  const [storage, setStorage] = useState('');
  const [color, setColor] = useState('');
  const [condition, setCondition] = useState('');
  const [battery, setBattery] = useState('');
  const [sim, setSim] = useState('');
  const [network, setNetwork] = useState('');
  const [faceId, setFaceId] = useState('');

  const [aed, setAed] = useState('');
  const [usd, setUsd] = useState('');
  const [finalUsd, setFinalUsd] = useState('');

  const [images, setImages] = useState<string[]>([]);
  const [rawImages, setRawImages] = useState<string[]>([]);
  const [supplierNotes, setSupplierNotes] = useState('');
  const [publicDesc, setPublicDesc] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const models = useMemo(() => {
    if (category === 'iphone') return IPHONE_MODELS;
    if (category === 'samsung') return SAMSUNG_MODELS;
    if (category === 'pixel') return PIXEL_MODELS;
    return null;
  }, [category]);

  const showFreeText =
    category === 'other_phone' ||
    (models && (model === 'Other iPhone' || model === 'Other Samsung' || model === 'Other Pixel'));

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 8 - images.length);
    for (const f of list) {
      try {
        const compressed = await compressImage(f, 1600, 0.8);
        const raw = await fileToDataUrl(f);
        setImages(prev => [...prev, compressed]);
        setRawImages(prev => [...prev, raw]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const removeImage = (i: number) => {
    setImages(prev => prev.filter((_, idx) => idx !== i));
    setRawImages(prev => prev.filter((_, idx) => idx !== i));
  };

  const refineTitle = async () => {
    const seed = modelOther || refinedTitle;
    if (!seed.trim()) return;
    setRefining(true);
    try {
      const { data, error } = await supabase.functions.invoke('dubai-refine-title', {
        body: { text: `${seed} ${storage} ${color}`.trim() },
        headers: { 'x-dubai-token': token },
      });
      if (error || !(data as any)?.ok) throw new Error('refine_failed');
      setRefinedTitle((data as any).title);
      toast.success(t.titleImproved);
    } catch {
      toast.error(t.aiError);
    } finally { setRefining(false); }
  };

  const submit = async () => {
    if (images.length === 0) { toast.error(t.addOnePhoto); return; }
    if (!category) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('dubai-upload-submit', {
        body: {
          category,
          model: showFreeText ? null : model,
          model_other_text: showFreeText ? modelOther : null,
          refined_title: refinedTitle || null,
          storage, color, condition,
          battery_health: battery,
          sim_type: sim, network_status: network, face_id: faceId,
          dubai_price_aed: aed, dubai_price_usd: usd, final_price_usd: finalUsd,
          images, raw_images: rawImages,
          supplier_notes: supplierNotes, public_description: publicDesc,
        },
        headers: { 'x-dubai-token': token },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error || 'failed');
      setDone(true);
      toast.success(t.sent);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || t.sendError);
    } finally { setSubmitting(false); }
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
          <Button onClick={() => { setDone(false); setImages([]); setRawImages([]); setRefinedTitle(''); setModel(''); setModelOther(''); }}>
            {t.sendAnother}
          </Button>
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
            >EN</button>
            <button
              type="button"
              onClick={() => setLang('fr')}
              className={`px-2.5 py-1.5 ${lang === 'fr' ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
            >FR</button>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4 space-y-5">
        {/* Photos */}
        <section className="space-y-2">
          <Label>{t.photos} ({images.length}/8)</Label>
          <input
            ref={fileRef} type="file" accept="image/*" multiple capture="environment"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button type="button" onClick={() => fileRef.current?.click()} className="w-full h-14" disabled={images.length >= 8}>
            <Upload className="h-5 w-5 mr-2" /> {t.addPhotos}
          </Button>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden border">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => removeImage(i)} type="button"
                    className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">{t.main}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Category */}
        <section className="space-y-2">
          <Label>{t.category}</Label>
          <Select value={category} onValueChange={(v) => { setCategory(v); setModel(''); setModelOther(''); }}>
            <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORY_KEYS.map(c => <SelectItem key={c} value={c}>{t.categories[c]}</SelectItem>)}
            </SelectContent>
          </Select>
        </section>

        {/* Model dropdown */}
        {models && (
          <section className="space-y-2">
            <Label>{t.model}</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-12"><SelectValue placeholder={t.chooseModel} /></SelectTrigger>
              <SelectContent>
                {models.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </section>
        )}

        {/* Free text + AI refine */}
        {showFreeText && (
          <section className="space-y-2">
            <Label>{t.phoneName}</Label>
            <Input
              placeholder={t.phonePlaceholder}
              value={modelOther}
              onChange={(e) => setModelOther(e.target.value)}
              className="h-12"
            />
            <Button type="button" variant="secondary" onClick={refineTitle} disabled={refining || !modelOther.trim()} className="w-full h-11">
              {refining ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {t.improveTitle}
            </Button>
            {refinedTitle && (
              <p className="text-xs text-emerald-600 break-words">→ {refinedTitle}</p>
            )}
          </section>
        )}

        {/* Details */}
        <section className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t.storage}</Label>
            <Select value={storage} onValueChange={setStorage}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{STORAGE_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t.color}</Label>
            <Input value={color} onChange={e => setColor(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1">
            <Label>{t.condition}</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{CONDITION_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t.battery}</Label>
            <Input type="number" min={0} max={100} value={battery} onChange={e => setBattery(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>{t.sim}</Label>
            <Select value={sim} onValueChange={setSim}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{SIM_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t.network}</Label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{NETWORK_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t.faceId}</Label>
            <Select value={faceId} onValueChange={setFaceId}>
              <SelectTrigger className="h-11"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{FACEID_OPTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </section>

        {/* Prices */}
        <section className="space-y-2 rounded-lg border p-3 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground">{t.pricesHint}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t.aed}</Label>
              <Input type="number" value={aed} onChange={e => setAed(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1">
              <Label>{t.usd}</Label>
              <Input type="number" value={usd} onChange={e => setUsd(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label>{t.finalUsd}</Label>
              <Input type="number" value={finalUsd} onChange={e => setFinalUsd(e.target.value)} className="h-11" placeholder={t.finalUsdPh} />
            </div>
          </div>
        </section>

        {/* Notes */}
        <section className="space-y-2">
          <Label>{t.notes}</Label>
          <Textarea value={supplierNotes} onChange={e => setSupplierNotes(e.target.value)} rows={2} />
          <Label>{t.publicDesc}</Label>
          <Textarea value={publicDesc} onChange={e => setPublicDesc(e.target.value)} rows={3} />
        </section>

        <Button onClick={submit} disabled={submitting || images.length === 0} className="w-full h-14 text-base font-semibold">
          {submitting ? <><Loader2 className="h-5 w-5 animate-spin mr-2" /> {t.submitting}</> : t.submit}
        </Button>
      </div>
    </div>
  );
}
