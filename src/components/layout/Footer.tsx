import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import afrifundLogo from '@/assets/afrifund-logo.png';
export function Footer() {
  const {
    t
  } = useLanguage();
  return <footer className="border-t border-border bg-muted/50">
      <div className="container mx-auto px-4 py-12">
        {/* Brand Section - Full Width */}
        <div className="mb-12 pb-8 border-b border-border">
          <div className="flex items-center space-x-3 mb-3">
            <div className="bg-white rounded-lg p-2">
              <img src={afrifundLogo} alt="AfriFund Logo" className="h-14 w-auto object-contain" />
            </div>
            <span className="font-semibold text-lg">
              AfriFund
            </span>
          </div>
          <p className="text-sm text-muted-foreground text-justify max-w-2xl">
            {t.home.heroSubtitle}
          </p>
        </div>

        {/* 4-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-6">
          {/* Quick Links */}
          <div className="flex flex-col">
            <h3 className="font-semibold mb-4">{t.nav.home}</h3>
            <ul className="space-y-2 text-sm text-justify">
              <li>
                <Link to="/how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t.nav.howItWorks}
                </Link>
              </li>
              <li>
                <Link to="/apply" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t.nav.apply}
                </Link>
              </li>
              <li>
                <Link to="/results" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t.nav.results}
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div className="flex flex-col">
            <h3 className="font-semibold mb-4">Legal</h3>
            <ul className="space-y-2 text-sm text-justify">
              <li>
                <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                  Terms & Conditions
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Support / Learn More */}
          <div className="flex flex-col">
            <h3 className="font-semibold mb-4">{t.common.learnMore}</h3>
            <ul className="space-y-2 text-sm text-justify">
              <li>
                <Link to="/contact" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t.nav.contact}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="flex flex-col">
            <h3 className="font-semibold mb-4">{t.nav.contact}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground text-justify">
              <li>
                <a href="mailto:info@afri-fund.org" className="hover:text-foreground transition-colors">
                  info@afri-fund.org
                </a>
              </li>
              <li>
                <a 
                  href="https://wa.me/243972809832" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500 hover:bg-green-600 text-white transition-colors text-xs font-medium"
                  title="Chat on WhatsApp"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                </a>
              </li>
              <li>Lubumbashi, DRC</li>
            </ul>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-12 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} AfriFund. All rights reserved.</p>
        </div>
      </div>
    </footer>;
}