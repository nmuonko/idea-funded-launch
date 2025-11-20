import { useEffect, useState } from 'react';

const carouselImages = [
  {
    url: 'https://images.unsplash.com/photo-1556740738-b6a63e27c4df',
    alt: 'Small business workspace'
  },
  {
    url: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0',
    alt: 'Entrepreneurs working together'
  },
  {
    url: 'https://images.unsplash.com/photo-1559136555-9303baea8ebd',
    alt: 'Local business community'
  },
  {
    url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4',
    alt: 'Team collaboration'
  },
  {
    url: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf',
    alt: 'Business planning'
  }
];

export function HeroCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % carouselImages.length);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl">
      {/* Carousel Images */}
      {carouselImages.map((image, index) => (
        <div
          key={index}
          className={`absolute inset-0 transition-opacity duration-1000 ${
            index === currentIndex ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <img
            src={image.url}
            alt={image.alt}
            className="w-full h-full object-cover"
          />
          {/* Glossy overlay */}
          <div className="absolute inset-0 bg-gradient-glossy" />
        </div>
      ))}
      
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      
      {/* Dots indicator */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {carouselImages.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentIndex 
                ? 'bg-white w-8' 
                : 'bg-white/50 hover:bg-white/75'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
