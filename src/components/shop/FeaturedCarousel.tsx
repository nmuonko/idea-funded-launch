import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';

interface FeaturedItem {
  id: string;
  title: string;
  subtitle: string;
  gradient: string;
  searchQuery: string;
}

const featuredItems: FeaturedItem[] = [
  {
    id: 'iphone',
    title: 'iPhone 16 Pro Max',
    subtitle: 'Latest Apple flagship',
    gradient: 'from-purple-600 via-pink-500 to-red-500',
    searchQuery: 'iphone 16 pro max',
  },
  {
    id: 'luxury-cars',
    title: 'Luxury Vehicles',
    subtitle: 'Premium automobiles',
    gradient: 'from-amber-500 via-orange-500 to-red-600',
    searchQuery: 'luxury car mercedes bmw',
  },
  {
    id: 'xbox',
    title: 'Xbox Series X',
    subtitle: 'Next-gen gaming',
    gradient: 'from-green-500 via-emerald-500 to-teal-500',
    searchQuery: 'xbox series x console',
  },
  {
    id: 'vision-pro',
    title: 'Apple Vision Pro',
    subtitle: 'Spatial computing',
    gradient: 'from-slate-400 via-gray-300 to-zinc-400',
    searchQuery: 'apple vision pro',
  },
  {
    id: 'macbook',
    title: 'MacBook Pro M4',
    subtitle: 'Pro performance',
    gradient: 'from-blue-500 via-indigo-500 to-purple-600',
    searchQuery: 'macbook pro m4',
  },
  {
    id: 'ps5',
    title: 'PlayStation 5',
    subtitle: 'Play has no limits',
    gradient: 'from-blue-600 via-indigo-600 to-violet-600',
    searchQuery: 'playstation 5 console',
  },
];

export function FeaturedCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Auto-scroll every 3 seconds
  useEffect(() => {
    if (isPaused) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % featuredItems.length);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isPaused]);

  return (
    <div 
      className="relative overflow-hidden py-4"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Gradient Overlays */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
      
      {/* Animated Container */}
      <motion.div
        className="flex gap-4 px-4"
        animate={{
          x: `-${currentIndex * 280}px`,
        }}
        transition={{
          type: 'spring',
          stiffness: 100,
          damping: 20,
        }}
      >
        {/* Duplicate items for infinite scroll effect */}
        {[...featuredItems, ...featuredItems].map((item, index) => (
          <Link
            key={`${item.id}-${index}`}
            to={`/shop/search?q=${encodeURIComponent(item.searchQuery)}`}
            className="flex-shrink-0 group"
          >
            <motion.div
              className={`relative w-64 h-32 rounded-2xl bg-gradient-to-r ${item.gradient} p-4 overflow-hidden cursor-pointer`}
              whileHover={{ scale: 1.05, y: -4 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              {/* Shimmer Effect */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              </div>
              
              {/* Sparkle Icon */}
              <motion.div
                className="absolute top-3 right-3"
                animate={{ rotate: [0, 15, -15, 0] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <Sparkles className="h-5 w-5 text-white/80" />
              </motion.div>
              
              {/* Content */}
              <div className="relative z-10 h-full flex flex-col justify-end">
                <h3 className="text-lg font-bold text-white drop-shadow-lg">
                  {item.title}
                </h3>
                <p className="text-sm text-white/80">{item.subtitle}</p>
                
                {/* Hover Arrow */}
                <motion.div
                  className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100"
                  initial={{ x: -10 }}
                  whileHover={{ x: 0 }}
                >
                  <ArrowRight className="h-5 w-5 text-white" />
                </motion.div>
              </div>
              
              {/* Decorative Circles */}
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-black/20 blur-xl" />
            </motion.div>
          </Link>
        ))}
      </motion.div>
      
      {/* Dots Indicator */}
      <div className="flex justify-center gap-2 mt-4">
        {featuredItems.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentIndex % featuredItems.length
                ? 'bg-blue-500 w-6'
                : 'bg-white/30 hover:bg-white/50'
            }`}
          />
        ))}
      </div>
    </div>
  );
}