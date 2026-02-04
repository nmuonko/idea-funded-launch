import { isProduction, isLovablePreview, getEnvironmentName } from '@/lib/environment';

export function EnvironmentBadge() {
  // Only show in non-production environments
  if (isProduction()) return null;

  const envName = getEnvironmentName();
  const isPreview = isLovablePreview();

  return (
    <div className="fixed top-2 left-2 z-[100] pointer-events-none">
      <span
        className={`px-2 py-1 text-xs font-bold rounded uppercase ${
          isPreview
            ? 'bg-orange-500/90 text-white'
            : 'bg-yellow-500/90 text-black'
        }`}
      >
        {envName}
      </span>
    </div>
  );
}
