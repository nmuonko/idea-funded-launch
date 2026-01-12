import { ShoppingCart, Bookmark } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/contexts/LanguageContext';
import ActiveCartsContent from './ActiveCartsContent';
import SavedCartsContent from './SavedCartsContent';

export default function CartsManagement() {
  const { language } = useLanguage();

  const text = {
    title: language === 'fr' ? 'Gestion des paniers' : 'Carts Management',
    subtitle: language === 'fr' ? 'Gérer les paniers actifs et les articles sauvegardés' : 'Manage active carts and saved items',
    activeCarts: language === 'fr' ? 'Paniers actifs' : 'Active Carts',
    savedItems: language === 'fr' ? 'Articles sauvegardés' : 'Saved Items',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-8 w-8" />
          {text.title}
        </h1>
        <p className="text-muted-foreground">{text.subtitle}</p>
      </div>

      <Tabs defaultValue="active" className="space-y-4">
        <TabsList>
          <TabsTrigger value="active" className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            {text.activeCarts}
          </TabsTrigger>
          <TabsTrigger value="saved" className="flex items-center gap-2">
            <Bookmark className="h-4 w-4" />
            {text.savedItems}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <ActiveCartsContent />
        </TabsContent>

        <TabsContent value="saved">
          <SavedCartsContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
