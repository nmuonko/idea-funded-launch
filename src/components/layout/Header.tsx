import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, User, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ColorCustomization } from '@/components/ColorCustomization';
import afrifundLogo from '@/assets/afrifund-logo.png';

export function Header() {
  const { t } = useLanguage();
  const { user, isAdmin } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { to: '/', label: t.nav.home },
    { to: '/how-it-works', label: t.nav.howItWorks },
    { to: '/apply', label: t.nav.apply },
    { to: '/results', label: t.nav.results },
    { to: '/terms', label: t.nav.terms },
    { to: '/contact', label: t.nav.contact },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <nav className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3">
            <img 
              src={afrifundLogo} 
              alt="AfriFund Logo" 
              className="h-10 w-auto object-contain"
            />
            <span className="hidden sm:inline-block font-semibold text-lg">
              AfriFund
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right section */}
          <div className="flex items-center space-x-4">
            <ColorCustomization />
            <LanguageSwitcher />
            {user && (
              <>
                {isAdmin && (
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <Link to="/admin">
                      <Shield className="h-4 w-4" />
                      Admin
                    </Link>
                  </Button>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link to="/auth">
                    <User className="h-4 w-4" />
                  </Link>
                </Button>
              </>
            )}
            {!user && (
              <Button asChild size="sm">
                <Link to="/auth">Sign In</Link>
              </Button>
            )}
            
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            <div className="flex flex-col space-y-3">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
