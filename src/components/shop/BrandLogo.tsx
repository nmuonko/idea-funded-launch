import React from 'react';

type BrandKey = 'iphone' | 'samsung' | 'pixel';

interface Props {
  brand: BrandKey;
  className?: string;
}

export const BrandLogo: React.FC<Props> = ({ brand, className = 'w-4 h-4' }) => {
  if (brand === 'iphone') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
        <path d="M16.365 1.43c0 1.14-.42 2.23-1.18 3.04-.78.83-2.04 1.47-3.06 1.39-.13-1.13.45-2.3 1.16-3.06.79-.85 2.14-1.49 3.08-1.37zM20.5 17.36c-.55 1.27-.81 1.83-1.51 2.95-.98 1.56-2.36 3.5-4.07 3.52-1.52.01-1.91-.99-3.97-.98-2.06.01-2.49.99-4.01.97-1.71-.02-3.02-1.78-4-3.34C.18 16.13-.14 10.79 1.94 7.85c1.46-2.06 3.77-3.27 5.94-3.27 2.21 0 3.6 1.21 5.43 1.21 1.77 0 2.85-1.21 5.41-1.21 1.94 0 4 .96 5.47 2.63-4.81 2.64-4.03 9.51.31 11.15z"/>
      </svg>
    );
  }
  if (brand === 'pixel') {
    // Google "G" multicolor
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.93 11.93 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
      </svg>
    );
  }
  // Samsung — iconic blue ellipse with white SAMSUNG wordmark
  return (
    <svg viewBox="0 0 120 36" className={className} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <ellipse cx="60" cy="18" rx="58" ry="16" fill="#1428A0" />
      <text
        x="60"
        y="23"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="700"
        fontSize="14"
        fill="#ffffff"
        letterSpacing="1"
      >
        SAMSUNG
      </text>
    </svg>
  );
};
