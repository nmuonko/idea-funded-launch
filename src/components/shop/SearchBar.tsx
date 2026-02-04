import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const RECENT_SEARCHES_KEY = 'afrishop_recent_searches';
const MAX_RECENT_SEARCHES = 5;

interface SearchBarProps {
  defaultValue?: string;
  className?: string;
  onSearch?: (query: string) => void;
  autoFocus?: boolean;
}

export function SearchBar({ defaultValue = '', className, onSearch, autoFocus }: SearchBarProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(defaultValue || searchParams.get('q') || '');
  const [showRecent, setShowRecent] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load recent searches
  useEffect(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse recent searches:', e);
      }
    }
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowRecent(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveRecentSearch = (search: string) => {
    const trimmed = search.trim();
    if (!trimmed) return;
    
    const updated = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, MAX_RECENT_SEARCHES);
    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    
    saveRecentSearch(trimmed);
    setShowRecent(false);
    
    if (onSearch) {
      onSearch(trimmed);
    } else {
      navigate(`/shop/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const handleRecentClick = (search: string) => {
    setQuery(search);
    setShowRecent(false);
    saveRecentSearch(search);
    
    if (onSearch) {
      onSearch(search);
    } else {
      navigate(`/shop/search?q=${encodeURIComponent(search)}`);
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <form onSubmit={handleSubmit} className="relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-blue-400 group-focus-within:text-blue-300 transition-colors" />
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowRecent(true)}
          placeholder="Search millions of products..."
          autoFocus={autoFocus}
          className="w-full pl-12 pr-12 h-11 md:h-12 bg-white/10 border-2 border-blue-500/30 text-white placeholder:text-white/50 rounded-full focus:bg-white/15 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all text-sm md:text-base font-medium"
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0 text-white/40 hover:text-white hover:bg-white/10 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="sm"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-3 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-xs font-semibold hidden md:flex"
          >
            Search
          </Button>
        )}
      </form>

      {/* Recent Searches Dropdown */}
      {showRecent && recentSearches.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-black/95 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
            <span className="text-xs text-white/40 uppercase tracking-wider">Recent Searches</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearRecentSearches}
              className="text-xs text-white/40 hover:text-white h-auto p-1"
            >
              Clear
            </Button>
          </div>
          <div className="py-2">
            {recentSearches.map((search, index) => (
              <button
                key={index}
                onClick={() => handleRecentClick(search)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Clock className="h-4 w-4 text-white/40" />
                <span className="truncate">{search}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
