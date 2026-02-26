import { useState, useEffect, useRef, ReactNode } from 'react';

interface LazySectionProps {
  children: ReactNode;
  minHeight?: number;
}

export function LazySection({ children, minHeight = 200 }: LazySectionProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        minHeight: visible ? undefined : minHeight,
        contentVisibility: visible ? undefined : 'auto',
        containIntrinsicSize: visible ? undefined : `auto ${minHeight}px`,
      } as React.CSSProperties}
    >
      {visible ? children : null}
    </div>
  );
}
