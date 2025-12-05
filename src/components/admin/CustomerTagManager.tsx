import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tag, Plus, X, Settings } from 'lucide-react';
import { toast } from 'sonner';

interface CustomerTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
}

interface CustomerTagManagerProps {
  customerId: string;
  customerTags?: CustomerTag[];
  onTagsChange?: () => void;
}

const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
];

export function CustomerTagManager({ customerId, customerTags = [], onTagsChange }: CustomerTagManagerProps) {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  
  const [allTags, setAllTags] = useState<CustomerTag[]>([]);
  const [assignedTagIds, setAssignedTagIds] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTags();
    loadAssignedTags();
  }, [customerId]);

  const loadTags = async () => {
    const { data } = await supabase.from('customer_tags').select('*').order('name');
    if (data) setAllTags(data);
  };

  const loadAssignedTags = async () => {
    const { data } = await supabase
      .from('customer_tag_assignments')
      .select('tag_id')
      .eq('customer_id', customerId);
    if (data) {
      setAssignedTagIds(new Set(data.map(d => d.tag_id)));
    }
  };

  const createTag = async () => {
    if (!newTagName.trim()) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('customer_tags').insert({
        name: newTagName.trim(),
        color: newTagColor,
      });
      if (error) throw error;
      toast.success('Tag created');
      setNewTagName('');
      setIsCreating(false);
      loadTags();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleTag = async (tagId: string) => {
    setLoading(true);
    try {
      if (assignedTagIds.has(tagId)) {
        await supabase
          .from('customer_tag_assignments')
          .delete()
          .eq('customer_id', customerId)
          .eq('tag_id', tagId);
        assignedTagIds.delete(tagId);
      } else {
        await supabase.from('customer_tag_assignments').insert({
          customer_id: customerId,
          tag_id: tagId,
        });
        assignedTagIds.add(tagId);
      }
      setAssignedTagIds(new Set(assignedTagIds));
      onTagsChange?.();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const assignedTags = allTags.filter(t => assignedTagIds.has(t.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {assignedTags.map(tag => (
          <Badge
            key={tag.id}
            style={{ backgroundColor: tag.color }}
            className="text-white text-xs"
          >
            {tag.name}
            <button
              onClick={() => toggleTag(tag.id)}
              className="ml-1 hover:opacity-70"
              disabled={loading}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
              <Plus className="h-3 w-3 mr-1" />
              {t.customers?.addTag || 'Add Tag'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="space-y-2">
              {allTags.map(tag => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer"
                  onClick={() => toggleTag(tag.id)}
                >
                  <Checkbox checked={assignedTagIds.has(tag.id)} />
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-sm flex-1">{tag.name}</span>
                </div>
              ))}
              
              {isCreating ? (
                <div className="pt-2 border-t space-y-2">
                  <Input
                    placeholder="Tag name"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {TAG_COLORS.map(color => (
                      <button
                        key={color}
                        className={`w-5 h-5 rounded ${newTagColor === color ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewTagColor(color)}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={createTag} disabled={loading} className="flex-1">
                      {t.common?.save || 'Save'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setIsCreating(false)}>
                      {t.common?.cancel || 'Cancel'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => setIsCreating(true)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t.customers?.createTag || 'Create new tag'}
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

// Tag filter component for Customers page
interface TagFilterProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function CustomerTagFilter({ selectedTags, onTagsChange }: TagFilterProps) {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const [tags, setTags] = useState<CustomerTag[]>([]);

  useEffect(() => {
    supabase.from('customer_tags').select('*').order('name').then(({ data }) => {
      if (data) setTags(data);
    });
  }, []);

  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      onTagsChange(selectedTags.filter(t => t !== tagId));
    } else {
      onTagsChange([...selectedTags, tagId]);
    }
  };

  if (tags.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Tag className="h-4 w-4" />
          {t.customers?.tags || 'Tags'}
          {selectedTags.length > 0 && (
            <Badge variant="secondary" className="ml-1">{selectedTags.length}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          {tags.map(tag => (
            <div
              key={tag.id}
              className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer"
              onClick={() => toggleTag(tag.id)}
            >
              <Checkbox checked={selectedTags.includes(tag.id)} />
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="text-sm">{tag.name}</span>
            </div>
          ))}
          {selectedTags.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs mt-2"
              onClick={() => onTagsChange([])}
            >
              {t.common?.clear || 'Clear'} ({selectedTags.length})
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
