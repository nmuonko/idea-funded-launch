import { Helmet } from 'react-helmet-async';

/**
 * Tells search engines NOT to index the current page.
 * Use on private/per-user pages (cart, orders, account, saved, checkout)
 * and on product pages where the underlying item is unavailable.
 */
export function NoIndex() {
  return (
    <Helmet>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="googlebot" content="noindex, nofollow" />
    </Helmet>
  );
}

export default NoIndex;
