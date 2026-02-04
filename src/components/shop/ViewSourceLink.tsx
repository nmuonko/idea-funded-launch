import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface ViewSourceLinkProps {
  productUrl: string;
  provider?: string;
  className?: string;
}

export function ViewSourceLink({ productUrl, provider, className }: ViewSourceLinkProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  // Extract store name from URL
  const getStoreName = () => {
    if (provider) {
      return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
    try {
      const url = new URL(productUrl);
      if (url.hostname.includes('amazon')) return 'Amazon';
      if (url.hostname.includes('ebay')) return 'eBay';
      return url.hostname.replace('www.', '');
    } catch {
      return 'Store';
    }
  };

  return (
    <a
      href={productUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors ${className}`}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span>
        {shop.viewOn || 'View on'} {getStoreName()}
      </span>
    </a>
  );
}
