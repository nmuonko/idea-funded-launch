import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Search, BookOpen, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { SEOHead } from '@/components/SEOHead';

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  view_count: number;
  created_at: string;
  updated_at: string;
}

export default function KnowledgeBase() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [filteredArticles, setFilteredArticles] = useState<Article[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchArticles();
  }, []);

  useEffect(() => {
    filterArticles();
  }, [searchQuery, selectedCategory, articles]);

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('knowledge_base_articles')
        .select('*')
        .eq('published', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      toast.error('Failed to load knowledge base');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const filterArticles = () => {
    let filtered = articles;

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(a => a.category === selectedCategory);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        a =>
          a.title.toLowerCase().includes(query) ||
          a.content.toLowerCase().includes(query) ||
          a.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    setFilteredArticles(filtered);
  };

  const handleArticleClick = async (article: Article) => {
    setSelectedArticle(article);
    setDialogOpen(true);

    // Increment view count
    try {
      await supabase
        .from('knowledge_base_articles')
        .update({ view_count: article.view_count + 1 })
        .eq('id', article.id);
    } catch (error) {
      console.error('Failed to update view count', error);
    }
  };

  const categories = Array.from(new Set(articles.map(a => a.category)));

  return (
    <SEOHead title="Knowledge Base" description="FAQs and help articles for shopping USA products and getting them delivered to DR Congo with AfriShop." />
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-ocean bg-clip-text text-transparent">
            Knowledge Base
          </h1>
          <p className="text-muted-foreground">
            Find answers to common questions and learn more about our services
          </p>
        </div>

        <Card className="glass-strong">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setSelectedCategory('all')}
          >
            All Categories
          </Badge>
          {categories.map(cat => (
            <Badge
              key={cat}
              variant={selectedCategory === cat ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </Badge>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : filteredArticles.length === 0 ? (
          <Card className="glass-strong">
            <CardContent className="py-12 text-center text-muted-foreground">
              No articles found matching your search.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredArticles.map(article => (
              <Card
                key={article.id}
                className="glass-strong cursor-pointer hover:shadow-glow transition-smooth"
                onClick={() => handleArticleClick(article)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <BookOpen className="h-5 w-5 text-primary" />
                      {article.title}
                    </CardTitle>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {article.content.substring(0, 100)}...
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <Badge variant="outline">{article.category}</Badge>
                    <div className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {article.view_count} views
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                {selectedArticle?.title}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <Badge variant="outline">{selectedArticle?.category}</Badge>
                <span className="text-xs">
                  Updated {selectedArticle && formatDistanceToNow(new Date(selectedArticle.updated_at), { addSuffix: true })}
                </span>
              </DialogDescription>
            </DialogHeader>

            {selectedArticle && (
              <div className="space-y-6">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <div className="whitespace-pre-wrap">{selectedArticle.content}</div>
                </div>

                {selectedArticle.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectedArticle.tags.map((tag, idx) => (
                      <Badge key={idx} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
