import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

export function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-border bg-muted/50">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
                PC
              </div>
              <span className="font-semibold text-lg">
                Project Competition
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.home.heroSubtitle}
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">{t.nav.home}</h3>
            <ul className="space-y-2 text-sm">
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

          <div>
            <h3 className="font-semibold mb-4">Legal</h3>
            <ul className="space-y-2 text-sm">
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

          {/* Support */}
          <div>
            <h3 className="font-semibold mb-4">{t.common.learnMore}</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/contact" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t.nav.contact}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="font-semibold mb-4">{t.nav.contact}</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>contact@projectcompetition.org</li>
              <li>+243 XXX XXX XXX</li>
              <li>Kinshasa, DRC</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Project Competition. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
