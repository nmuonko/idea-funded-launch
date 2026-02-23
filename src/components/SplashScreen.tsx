import { useEffect, useState } from 'react';
import afrishopLogo from '@/assets/afrishop-logo.png';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number;
}

export default function SplashScreen({ onComplete, duration = 2500 }: SplashScreenProps) {
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), duration - 500);
    const completeTimer = setTimeout(onComplete, duration);
    
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, duration]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)] transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-1/2 right-1/3 w-48 h-48 bg-primary/8 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Logo container with animations */}
      <div className="relative flex flex-col items-center gap-8">
        {/* Glowing ring behind logo */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-40 h-40 rounded-full border-2 border-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full border border-primary/30 animate-pulse" />
        </div>

        {/* Logo with scale and fade animation */}
        <div className="relative animate-[scale-in_0.8s_ease-out]">
          <img 
            src={afrishopLogo} 
            alt="AfriShop" 
            className="h-20 md:h-24 w-auto brightness-0 invert"
          />
        </div>

        {/* Loading indicator */}
        <div className="flex items-center gap-2 mt-4">
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>

        {/* Tagline */}
        <p className="text-muted-foreground text-sm tracking-widest uppercase animate-fade-in" style={{ animationDelay: '0.5s' }}>
          Admin Portal
        </p>
      </div>
    </div>
  );
}
