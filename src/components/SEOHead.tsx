import { Helmet } from 'react-helmet-async';

interface SEOHeadProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  type?: string;
  price?: number;
  currency?: string;
  availability?: 'in stock' | 'out of stock';
}

export function SEOHead({
  title,
  description,
  image,
  url,
  type = 'website',
  price,
  currency = 'USD',
  availability,
}: SEOHeadProps) {
  const fullTitle = title.includes('AfriShop') ? title : `${title} | AfriShop`;
  const canonical = url || (typeof window !== 'undefined' ? window.location.href : '');

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      {canonical && <meta property="og:url" content={canonical} />}
      {image && <meta property="og:image" content={image} />}

      {/* Twitter */}
      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}

      {/* Product structured data */}
      {type === 'product' && price && (
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: title,
            description,
            image: image || undefined,
            offers: {
              '@type': 'Offer',
              price: price.toFixed(2),
              priceCurrency: currency,
              availability: availability === 'in stock'
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            },
          })}
        </script>
      )}
    </Helmet>
  );
}
