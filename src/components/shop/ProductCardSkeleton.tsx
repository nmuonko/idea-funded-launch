import { cn } from '@/lib/utils';

interface ProductCardSkeletonProps {
  compact?: boolean;
  className?: string;
}

export function ProductCardSkeleton({ compact = false, className }: ProductCardSkeletonProps) {
  return (
    <div
      className={cn(
        "block bg-white/5 border border-white/[0.15] rounded-xl sm:rounded-2xl overflow-hidden",
        className
      )}
    >
      {/* Image skeleton with shimmer */}
      <div className={cn(
        "relative overflow-hidden bg-neutral-200/20",
        compact ? "aspect-[4/3]" : "aspect-[4/3] sm:aspect-square"
      )}>
        <div className="absolute inset-0 shimmer" />
      </div>

      {/* Content skeleton */}
      <div className={cn("p-2.5 sm:p-3 space-y-1.5 sm:space-y-2", compact && "p-1.5 sm:p-2 space-y-1 sm:space-y-1.5")}>
        {/* Title skeleton - 2 lines */}
        <div className="space-y-1.5">
          <div className="h-3 bg-white/10 rounded shimmer" />
          <div className="h-3 bg-white/10 rounded w-3/4 shimmer" />
        </div>

        {/* Price skeleton */}
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="h-5 bg-white/10 rounded w-16 shimmer" />
            <div className="h-3 bg-white/10 rounded w-20 shimmer" />
          </div>
          {/* Add button skeleton */}
          <div className="h-8 w-8 bg-white/10 rounded-full shimmer" />
        </div>
      </div>
    </div>
  );
}
