/**
 * Currency formatting utility - Single source of truth for price display
 * 
 * French: 10,00 $ (symbol AFTER number)
 * English: $10.00 (symbol BEFORE number)
 */

export type SupportedCurrency = 'USD' | 'CDF';
export type SupportedLocale = 'en' | 'fr' | 'sw' | 'ln';

interface FormatOptions {
  currency?: SupportedCurrency;
  locale?: SupportedLocale;
  showSymbol?: boolean;
  decimals?: number;
}

// Currency symbols
const SYMBOLS: Record<SupportedCurrency, string> = {
  USD: '$',
  CDF: 'FC',
};

/**
 * Format a number as currency based on locale
 * 
 * @example
 * formatCurrency(10.5, { locale: 'fr' }) // "10,50 $"
 * formatCurrency(10.5, { locale: 'en' }) // "$10.50"
 * formatCurrency(28000, { locale: 'fr', currency: 'CDF' }) // "28 000 FC"
 */
export function formatCurrency(
  amount: number | null | undefined,
  options: FormatOptions = {}
): string {
  const {
    currency = 'USD',
    locale = 'en',
    showSymbol = true,
    decimals = currency === 'CDF' ? 0 : 2,
  } = options;

  // Handle null/undefined
  if (amount == null || isNaN(amount)) {
    return showSymbol ? `${SYMBOLS[currency]}0` : '0';
  }

  const symbol = SYMBOLS[currency];
  
  // Format the number based on locale
  let formattedNumber: string;
  
  if (locale === 'fr' || locale === 'ln') {
    // French/Lingala: use comma as decimal, space as thousands separator
    formattedNumber = amount.toLocaleString('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } else {
    // English/Swahili: use period as decimal, comma as thousands separator
    formattedNumber = amount.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  if (!showSymbol) {
    return formattedNumber;
  }

  // French/Lingala: symbol AFTER number (e.g., "10,00 $")
  if (locale === 'fr' || locale === 'ln') {
    return `${formattedNumber} ${symbol}`;
  }

  // English/Swahili: symbol BEFORE number (e.g., "$10.00")
  return `${symbol}${formattedNumber}`;
}

/**
 * Format USD amount
 */
export function formatUSD(
  amount: number | null | undefined,
  locale: SupportedLocale = 'en'
): string {
  return formatCurrency(amount, { currency: 'USD', locale });
}

/**
 * Format CDF amount
 */
export function formatCDF(
  amount: number | null | undefined,
  locale: SupportedLocale = 'en'
): string {
  return formatCurrency(amount, { currency: 'CDF', locale, decimals: 0 });
}

/**
 * Format price with both USD and CDF
 */
export function formatPriceDual(
  usd: number | null | undefined,
  cdf: number | null | undefined,
  locale: SupportedLocale = 'en'
): { usd: string; cdf: string } {
  return {
    usd: formatUSD(usd, locale),
    cdf: formatCDF(cdf, locale),
  };
}
