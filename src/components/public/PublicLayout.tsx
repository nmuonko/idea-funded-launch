import { Link, useLocation } from "react-router-dom";
import { Download, LogIn, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import afrishopLogo from "@/assets/afrishop-logo.png";

const navLinks = [
  { to: "/", label: "How It Works" },
  { to: "/coverage", label: "Coverage" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/payments-compliance", label: "Payments" },
  { to: "/refunds", label: "Refunds" },
];

export const PublicHeader = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center">
          <img src={afrishopLogo} alt="AfriShop" className="h-10 md:h-12 drop-shadow-lg" />
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
    <footer className="bg-black border-t border-white/10 py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img src={afrishopLogo} alt="AfriShop" className="h-8 opacity-80" />
            <p className="text-sm text-white/50">
              © {new Date().getFullYear()} AfriShop. All rights reserved.
            </p>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-white/50 hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link to="/download" className="text-white/50 hover:text-white transition-colors">
              Download
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
};
