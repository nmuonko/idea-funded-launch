import { Link, useLocation } from "react-router-dom";
import { Download, LogIn, Menu, X, Mail, MapPin, Building2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import afrishopLogo from "@/assets/afrishop-logo.png";

const navLinks = [
  { to: "/browse", label: "Shop" },
  { to: "/", label: "How It Works" },
  { to: "/about", label: "About" },
  { to: "/coverage", label: "Coverage" },
  { to: "/payouts", label: "Payouts" },
  { to: "/contact", label: "Contact" },
];

const legalLinks = [
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/refunds", label: "Refunds" },
  { to: "/payouts", label: "Payouts & Beneficiaries" },
  { to: "/payments-compliance", label: "Payments" },
];

export const PublicHeader = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center">
          <img src={afrishopLogo} alt="AfriShop" className="h-10 md:h-12 drop-shadow-lg brightness-0 invert" />
        </Link>
        
        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-300 ${
                location.pathname === link.to
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/download" className="hidden sm:inline-flex">
            <Button 
              size="sm" 
              className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white border-0 rounded-full px-5"
            >
              <Download className="h-4 w-4 mr-2" />
              Get App
            </Button>
          </Link>
          <Link to="/auth?mode=admin">
            <Button size="sm" variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10 rounded-full">
              <LogIn className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Admin</span>
            </Button>
          </Link>
          
          {/* Mobile Menu Button */}
          <Button
            size="sm"
            variant="ghost"
            className="lg:hidden text-white/70 hover:text-white hover:bg-white/10"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-black/90 backdrop-blur-xl border-t border-white/10"
          >
            <nav className="container mx-auto px-4 py-4 flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  className={`px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                    location.pathname === link.to
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link to="/download" onClick={() => setMobileOpen(false)}>
                <Button className="w-full mt-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl">
                  <Download className="h-4 w-4 mr-2" />
                  Download App
                </Button>
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export const PublicFooter = () => {
  return (
    <footer className="bg-black border-t border-white/10">
      <div className="container mx-auto px-4 py-12">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {/* Brand & Company Info */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <img src={afrishopLogo} alt="AfriShop" className="h-10 brightness-0 invert" />
            </div>
            <div className="space-y-2 text-sm text-white/60">
              <p className="flex items-start gap-2">
                <Building2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-white/40" />
                <span>Operated by <strong className="text-white/80">AMERICAN GOODWILL SARL</strong></span>
              </p>
              <p className="flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 flex-shrink-0 text-white/40" />
                <span>RCCM: CD/LSH/RCCM/17-B-6093 | ID Nat: 05-F4300-N05127D</span>
              </p>
              <p className="flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0 text-white/40" />
                <span>114 Croisement Av. Ndjamena & Kasaï, Q. Makutano, Lubumbashi, Haut-Katanga, RDC</span>
              </p>
              <p className="flex items-start gap-2">
                <Mail className="h-4 w-4 mt-0.5 flex-shrink-0 text-white/40" />
                <a href="mailto:support@afrishop-usa.com" className="hover:text-white transition-colors">
                  support@afrishop-usa.com
                </a>
              </p>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4 text-white/90">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              {navLinks.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-white/50 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/download" className="text-white/50 hover:text-white transition-colors">
                  Download App
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold mb-4 text-white/90">Legal</h3>
            <ul className="space-y-2 text-sm">
              {legalLinks.map((link) => (
                <li key={link.to + link.label}>
                  <Link
                    to={link.to}
                    className="text-white/50 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-white/10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/40">
            <p>© {new Date().getFullYear()} AfriShop. All rights reserved.</p>
            <p>A brand of AMERICAN GOODWILL SARL</p>
          </div>
        </div>
      </div>
    </footer>
  );
};
