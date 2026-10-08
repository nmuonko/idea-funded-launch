/** One upload is one garment. Photos never multiply shipment weight or stock. */
export function groupVipPhotos(images: string[], results: Array<Record<string, any> | null>) {
  const primary = results.find((r) => r != null) ?? null;
  const unique = (values: string[]) => [...new Set(values)];
  return {
    primary,
    gallery: images.map((url, index) => ({ url, colors: Array.isArray(results[index]?.colors) ? results[index].colors.map(String) : [] })),
    colors: unique(results.flatMap((r) => Array.isArray(r?.colors) ? r.colors.map((c: unknown) => String(c).slice(0, 40)) : [])),
    sizes: unique(results.flatMap((r) => r?.size ? [String(r.size).slice(0, 20)] : [])),
    needsReview: results.some((r) => !r || Number(r.confidence ?? 1) < 0.6),
  };
}