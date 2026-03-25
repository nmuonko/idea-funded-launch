import { useState, useEffect } from 'react';
import { Star, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  created_at: string;
  user_id: string;
}

interface ProductReviewsProps {
  productId: string;
  provider: string;
}

export function ProductReviews({ productId, provider }: ProductReviewsProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    loadReviews();
  }, [productId]);

  const loadReviews = async () => {
    try {
      const { data } = await supabase
        .from('product_reviews')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(20);
      setReviews((data as Review[]) || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!user || rating === 0) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('product_reviews').upsert({
        user_id: user.id,
        product_id: productId,
        provider,
        rating,
        title: title.trim() || null,
        body: body.trim() || null,
      }, { onConflict: 'user_id,product_id' });

      if (error) throw error;
      toast.success(language === 'fr' ? 'Avis publié !' : 'Review submitted!');
      setShowForm(false);
      setRating(0);
      setTitle('');
      setBody('');
      loadReviews();
    } catch {
      toast.error(language === 'fr' ? 'Échec de l\'envoi' : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;

  return (
    <div className="pt-6 border-t border-white/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">
          {language === 'fr' ? 'Avis clients' : 'Customer Reviews'}
          {reviews.length > 0 && (
            <span className="text-sm text-white/50 ml-2">
              ({reviews.length}) • {avgRating.toFixed(1)} ★
            </span>
          )}
        </h3>
        {user && !showForm && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowForm(true)}
            className="border-white/20 text-white/70 hover:bg-white/10"
          >
            {language === 'fr' ? 'Écrire un avis' : 'Write a Review'}
          </Button>
        )}
      </div>

      {/* Review Form */}
      {showForm && (
        <div className="bg-white/5 rounded-xl border border-white/10 p-4 mb-4 space-y-3">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                onClick={() => setRating(s)}
                onMouseEnter={() => setHoverRating(s)}
                onMouseLeave={() => setHoverRating(0)}
                className="p-0.5"
              >
                <Star
                  className={`h-6 w-6 transition-colors ${
                    s <= (hoverRating || rating)
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-white/20'
                  }`}
                />
              </button>
            ))}
          </div>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={language === 'fr' ? 'Titre (optionnel)' : 'Title (optional)'}
            className="bg-white/5 border-white/10 text-white"
            maxLength={100}
          />
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={language === 'fr' ? 'Partagez votre expérience...' : 'Share your experience...'}
            className="bg-white/5 border-white/10 text-white min-h-[80px]"
            maxLength={1000}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || rating === 0}
              className="bg-white/10 hover:bg-white/20 text-white"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              {language === 'fr' ? 'Publier' : 'Submit'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowForm(false)}
              className="text-white/50"
            >
              {language === 'fr' ? 'Annuler' : 'Cancel'}
            </Button>
          </div>
        </div>
      )}

      {/* Reviews List */}
      {loading ? (
        <div className="text-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-white/40 mx-auto" />
        </div>
      ) : reviews.length === 0 ? (
        <p className="text-white/40 text-sm py-4 text-center">
          {language === 'fr' ? 'Aucun avis pour le moment. Soyez le premier !' : 'No reviews yet. Be the first!'}
        </p>
      ) : (
        <div className="space-y-3">
          {reviews.map(review => (
            <div key={review.id} className="bg-white/5 rounded-xl p-4 border border-white/5">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex">
                  {[1, 2, 3, 4, 5].map(s => (
                    <Star
                      key={s}
                      className={`h-3.5 w-3.5 ${
                        s <= review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-white/20'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-white/40">
                  {new Date(review.created_at).toLocaleDateString()}
                </span>
              </div>
              {review.title && <p className="text-sm font-medium text-white/90">{review.title}</p>}
              {review.body && <p className="text-sm text-white/60 mt-1">{review.body}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
