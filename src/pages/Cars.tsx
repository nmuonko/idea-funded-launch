import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Car, Search, ShoppingCart, MessageCircle, AlertTriangle, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { filterGalleryImages, isRenderableImageUrl } from "@/lib/imageValidation";
import { SEOHead } from '@/components/SEOHead';

interface CarListing {
  id: string;
  provider: string;
  providerListingId: string;
  title: string;
  price: number | null;
  mileage: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  location: string | null;
  imageUrl: string | null;
  images?: string[]; // Full gallery of images
  listingUrl: string | null;
  vin: string | null;
}

interface SearchResponse {
  status: string;
  mode?: string;
  message?: string;
  items: CarListing[];
  total?: number;
  page: number;
  pageSize: number;
  hasMore?: boolean;
  cached?: boolean;
  rateLimitExceeded?: boolean;
  budgetExceeded?: boolean;
}

export default function Cars() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [searchParams, setSearchParams] = useState({
    make: "",
    model: "",
    year_min: "",
    year_max: "",
    price_min: "",
    price_max: "",
  });
  const [page, setPage] = useState(1);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);

  // Fetch trending cars from cache (no API call)
  const { data: trendingCars, isLoading: trendingLoading } = useQuery({
    queryKey: ["cars-trending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cars_listings_cache")
        .select("*")
        .eq("is_trending", true)
        .order("updated_at", { ascending: false })
        .limit(12);
      
      if (error) throw error;
      
      return (data || []).map((row: any) => {
        // Parse images from JSON
        let rawImages: string[] = [];
        if (row.images) {
          try {
            rawImages = Array.isArray(row.images) ? row.images : [];
          } catch {
            rawImages = [];
          }
        }
        if (rawImages.length === 0 && row.image_url) {
          rawImages = [row.image_url];
        }
        // Filter out promo/banner images and upgrade to high-res
        const images = filterGalleryImages(rawImages);
        
        return {
          id: `${row.provider}:${row.provider_listing_id}`,
          provider: row.provider,
          providerListingId: row.provider_listing_id,
          title: row.title,
          price: row.price ? Number(row.price) : null,
          mileage: row.mileage,
          year: row.year,
          make: row.make,
          model: row.model,
          location: row.location,
          imageUrl: row.image_url,
          images,
          listingUrl: row.listing_url,
          vin: row.vin,
        };
      }) as CarListing[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Search handler
  const handleSearch = useCallback(async (pageNum: number = 1) => {
    setIsSearching(true);
    setPage(pageNum);
    
    try {
      const params = new URLSearchParams();
      if (searchParams.make) params.set("make", searchParams.make);
      if (searchParams.model) params.set("model", searchParams.model);
      if (searchParams.year_min) params.set("year_min", searchParams.year_min);
      if (searchParams.year_max) params.set("year_max", searchParams.year_max);
      if (searchParams.price_min) params.set("price_min", searchParams.price_min);
      if (searchParams.price_max) params.set("price_max", searchParams.price_max);
      params.set("page", String(pageNum));
      
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/cars-search?${params}`,
        { headers }
      );
      
      if (response.status === 429) {
        const data = await response.json();
        toast({
          title: "Rate limit exceeded",
          description: data.message || "Please try again later",
          variant: "destructive",
        });
        return;
      }
      
      const data: SearchResponse = await response.json();
      
      if (data.mode === "degraded") {
        setIsDegraded(true);
      }
      
      setSearchResults(data);
    } catch (error) {
      console.error("Search error:", error);
      toast({
        title: "Search failed",
        description: "Please try again later",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  }, [searchParams, toast]);

  // Add to cart mutation
  const addToCartMutation = useMutation({
    mutationFn: async (listing: CarListing) => {
      const { data: sessionData } = await supabase.auth.getSession();
      
      if (!sessionData?.session?.access_token) {
        throw new Error("Please log in to add items to cart");
      }
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/cars-add-to-cart`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${sessionData.session.access_token}`,
          },
          body: JSON.stringify({
            listingId: listing.id,
            title: listing.title,
            price: listing.price,
            imageUrl: listing.imageUrl,
            listingUrl: listing.listingUrl,
            vin: listing.vin,
            providerListingId: listing.providerListingId,
            provider: listing.provider,
          }),
        }
      );
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to add to cart");
      }
      
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: data.duplicate ? "Already in cart" : "Added to cart",
        description: data.requiresQuote 
          ? "This vehicle requires a shipping quote before checkout"
          : "Vehicle added to your cart",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatPrice = (price: number | null) => {
    if (price === null) return "Price on request";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatMileage = (mileage: number | null) => {
    if (mileage === null) return null;
    return new Intl.NumberFormat("en-US").format(mileage) + " mi";
  };

  // Car image gallery component
  const CarImageGallery = ({ car }: { car: CarListing }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const images = car.images && car.images.length > 0 ? car.images : (car.imageUrl ? [car.imageUrl] : []);
    const hasMultiple = images.length > 1;

    const handlePrev = (e: React.MouseEvent) => {
      e.stopPropagation();
      setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
    };

    const handleNext = (e: React.MouseEvent) => {
      e.stopPropagation();
      setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
    };

    return (
      <>
        <SEOHead title="Import Cars from USA to DR Congo" description="Order vehicles from the USA with AfriShop: transparent pricing, shipping, customs and delivery to the DRC." />
      <div className="aspect-video relative bg-muted group">
        {images.length > 0 ? (
          <>
            <img 
              src={images[currentIndex]} 
              alt={car.title || "Car"} 
              className="w-full h-full object-cover"
            />
            {hasMultiple && (
              <>
                {/* Navigation arrows */}
                <button
                  onClick={handlePrev}
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={handleNext}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                {/* Image counter badge */}
                <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  {currentIndex + 1}/{images.length}
                </div>
                {/* Dot indicators */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                  {images.slice(0, 5).map((_, idx) => (
                    <button
                      key={idx}
                      onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                      className={`w-1.5 h-1.5 rounded-full transition-colors ${
                        idx === currentIndex ? 'bg-white' : 'bg-white/50'
                      }`}
                    />
                  ))}
                  {images.length > 5 && (
                    <span className="text-white/70 text-xs ml-1">+{images.length - 5}</span>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>
      </>
    );
  };

  const renderCarCard = (car: CarListing) => (
    <Card key={car.id} className="overflow-hidden hover:shadow-lg transition-shadow">
      <CarImageGallery car={car} />
      <CardContent className="p-4">
        <h3 className="font-semibold text-lg line-clamp-2 mb-2">
          {car.title || `${car.year} ${car.make} ${car.model}`}
        </h3>
        <p className="text-2xl font-bold text-primary mb-2">
          {formatPrice(car.price)}
        </p>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {car.mileage && <span>{formatMileage(car.mileage)}</span>}
          {car.location && <span>• {car.location}</span>}
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex gap-2">
        <Button 
          className="flex-1"
          onClick={() => addToCartMutation.mutate(car)}
          disabled={addToCartMutation.isPending || !user}
        >
          <ShoppingCart className="w-4 h-4 mr-2" />
          Add to Cart
        </Button>
        {car.listingUrl && (
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => window.open(car.listingUrl!, "_blank")}
          >
            <Search className="w-4 h-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center gap-3 mb-8">
        <Car className="w-8 h-8 text-primary" />
        <h1 className="text-3xl font-bold">Find Your Car</h1>
      </div>

      {/* Search Form */}
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            <Input
              placeholder="Make (e.g., Toyota)"
              value={searchParams.make}
              onChange={(e) => setSearchParams(p => ({ ...p, make: e.target.value }))}
            />
            <Input
              placeholder="Model (e.g., Camry)"
              value={searchParams.model}
              onChange={(e) => setSearchParams(p => ({ ...p, model: e.target.value }))}
            />
            <Input
              placeholder="Year Min"
              type="number"
              value={searchParams.year_min}
              onChange={(e) => setSearchParams(p => ({ ...p, year_min: e.target.value }))}
            />
            <Input
              placeholder="Year Max"
              type="number"
              value={searchParams.year_max}
              onChange={(e) => setSearchParams(p => ({ ...p, year_max: e.target.value }))}
            />
            <Input
              placeholder="Price Min"
              type="number"
              value={searchParams.price_min}
              onChange={(e) => setSearchParams(p => ({ ...p, price_min: e.target.value }))}
            />
            <Input
              placeholder="Price Max"
              type="number"
              value={searchParams.price_max}
              onChange={(e) => setSearchParams(p => ({ ...p, price_max: e.target.value }))}
            />
          </div>
          <Button 
            onClick={() => handleSearch(1)} 
            disabled={isSearching}
            className="w-full md:w-auto"
          >
            <Search className="w-4 h-4 mr-2" />
            {isSearching ? "Searching..." : "Search Cars"}
          </Button>
        </CardContent>
      </Card>

      {/* Degraded Mode Banner */}
      {isDegraded && (
        <Card className="mb-8 border-warning bg-warning/10">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-6 h-6 text-warning flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-lg mb-2">Search Temporarily Limited</h3>
                <p className="text-muted-foreground mb-4">
                  Live search is currently unavailable. You can still browse trending cars below or request a specific vehicle.
                </p>
                <div className="flex gap-4">
                  <Button variant="outline" asChild>
                    <a href="/contact">
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Request a Car
                    </a>
                  </Button>
                  <Button variant="outline" asChild>
                    <a 
                      href="https://wa.me/1234567890?text=I'm looking for a car" 
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      WhatsApp
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Results */}
      {searchResults && searchResults.items.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold">
              Search Results
              {searchResults.total && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({searchResults.total} found)
                </span>
              )}
            </h2>
            {searchResults.cached && (
              <span className="text-sm text-muted-foreground">
                Cached results
              </span>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {searchResults.items.map(renderCarCard)}
          </div>
          
          {/* Pagination */}
          {(searchResults.hasMore || page > 1) && (
            <div className="flex justify-center gap-4 mt-8">
              <Button
                variant="outline"
                disabled={page <= 1 || isSearching}
                onClick={() => handleSearch(page - 1)}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
              <span className="flex items-center px-4">
                Page {page}
              </span>
              <Button
                variant="outline"
                disabled={!searchResults.hasMore || isSearching}
                onClick={() => handleSearch(page + 1)}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* No Results Message */}
      {searchResults && searchResults.items.length === 0 && !isSearching && (
        <Card className="mb-12">
          <CardContent className="p-12 text-center">
            <Car className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No cars found</h3>
            <p className="text-muted-foreground mb-4">
              Try adjusting your search criteria or browse trending cars below
            </p>
          </CardContent>
        </Card>
      )}

      {/* Trending Cars */}
      <div>
        <h2 className="text-2xl font-semibold mb-6">Trending Cars</h2>
        
        {trendingLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-video" />
                <CardContent className="p-4">
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-8 w-1/2 mb-2" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : trendingCars && trendingCars.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {trendingCars.map(renderCarCard)}
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center">
              <Car className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No trending cars yet</h3>
              <p className="text-muted-foreground">
                Search for cars to see listings here
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
