import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { BookOpen, Plus, Edit, Trash, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export default function KnowledgeBaseAdmin() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: '',
    tags: '',
    published: false,
  });

  useEffect(() => {
    fetchArticles();
  }, []);

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('knowledge_base_articles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error: any) {
      toast.error('Failed to load articles');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const tags = formData.tags.split(',').map(t => t.trim()).filter(t => t);
      
      if (editingArticle) {
        const { error } = await supabase
          .from('knowledge_base_articles')
          .update({
            title: formData.title,
            content: formData.content,
            category: formData.category,
            tags,
            published: formData.published,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingArticle.id);

        if (error) throw error;
        toast.success('Article updated successfully');
      } else {
        const { error } = await supabase.from('knowledge_base_articles').insert({
          title: formData.title,
          content: formData.content,
          category: formData.category,
          tags,
          published: formData.published,
          created_by: user.id,
        });

        if (error) throw error;
        toast.success('Article created successfully');
      }

      setDialogOpen(false);
      resetForm();
      fetchArticles();
    } catch (error: any) {
      toast.error('Failed to save article');
      console.error(error);
    }
  };

  const handleEdit = (article: Article) => {
    setEditingArticle(article);
    setFormData({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: article.tags.join(', '),
      published: article.published,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this article?')) return;

    try {
      const { error } = await supabase
        .from('knowledge_base_articles')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Article deleted');
      fetchArticles();
    } catch (error: any) {
      toast.error('Failed to delete article');
      console.error(error);
    }
  };

  const handleTogglePublish = async (article: Article) => {
    try {
      const { error } = await supabase
        .from('knowledge_base_articles')
        .update({ published: !article.published })
        .eq('id', article.id);

      if (error) throw error;
      toast.success(article.published ? 'Article unpublished' : 'Article published');
      fetchArticles();
    } catch (error: any) {
      toast.error('Failed to update article');
      console.error(error);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      category: '',
      tags: '',
      published: false,
    });
    setEditingArticle(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-ocean bg-clip-text text-transparent">
            Knowledge Base Management
          </h1>
          <p className="text-muted-foreground mt-2">
            Create and manage help articles for customers
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Article
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingArticle ? 'Edit Article' : 'Create New Article'}</DialogTitle>
              <DialogDescription>
                {editingArticle ? 'Update the article details' : 'Add a new help article to the knowledge base'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title</label>
                <Input
                  placeholder="Article title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Category</label>
                <Input
                  placeholder="e.g., Getting Started, Payments, Shipping"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Content</label>
                <Textarea
                  placeholder="Article content (supports plain text)"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={12}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Tags (comma-separated)</label>
                <Input
                  placeholder="e.g., payment, order, shipping"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.published}
                  onCheckedChange={(checked) => setFormData({ ...formData, published: checked })}
                />
                <label className="text-sm font-medium">Publish immediately</label>
              </div>
              <div className="flex gap-2">
                <Button type="submit">
                  {editingArticle ? 'Update Article' : 'Create Article'}
                </Button>
                <Button type="button" variant="outline" onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}>
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        </div>
      ) : articles.length === 0 ? (
        <Card className="glass-strong">
          <CardContent className="py-12 text-center text-muted-foreground">
            No articles yet. Create your first help article to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {articles.map((article) => (
            <Card key={article.id} className="glass-strong">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      {article.title}
                    </CardTitle>
                    <CardDescription className="mt-2 line-clamp-2">
                      {article.content.substring(0, 150)}...
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(article)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(article.id)}>
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-sm">
                    <Badge variant="outline">{article.category}</Badge>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      {article.view_count} views
                    </div>
                    <span className="text-muted-foreground">
                      {formatDistanceToNow(new Date(article.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {article.published ? 'Published' : 'Draft'}
                    </span>
                    <Switch
                      checked={article.published}
                      onCheckedChange={() => handleTogglePublish(article)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
