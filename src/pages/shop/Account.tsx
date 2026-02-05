import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  User, 
  ArrowLeft, 
  Globe, 
  Bell, 
  LogOut, 
  ChevronRight,
  Shield,
  HelpCircle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations, languages } from '@/lib/i18n/translations';

export default function Account() {
  const { user, profile, signOut } = useAuth();
  const { language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const t = translations[language] || translations.en;
  const shop = t.shop as any;
  
  const [notifications, setNotifications] = useState(true);

  const handleSignOut = async () => {
    await signOut();
    navigate('/browse');
  };

  return (
    <div className="min-h-screen bg-black pb-20">
      <ShopHeader />
      
      <main className="pt-20 px-4">
        <div className="container mx-auto max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Link to="/browse">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-white">
              {shop?.accountTab || 'Account'}
            </h1>
          </div>

          {/* Profile Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-4"
          >
            {user ? (
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center">
                  <User className="h-7 w-7 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-white truncate">
                    {profile?.full_name || user.email?.split('@')[0] || 'User'}
                  </h2>
                  <p className="text-sm text-white/60 truncate">
                    {user.email}
                  </p>
                </div>
                <Link to="/profile">
                  <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                    {shop?.editProfile || 'Edit'}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="text-center py-4">
                <User className="h-12 w-12 text-white/40 mx-auto mb-3" />
                <p className="text-white/60 mb-4">
                  {shop?.signInDescription || 'Sign in to access your account'}
                </p>
                <div className="flex gap-3 justify-center">
                  <Link to="/shop-auth">
                    <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6">
                      {shop?.signIn || 'Sign In'}
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </motion.section>

          {/* Settings Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mb-4"
          >
            {/* Language */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-white/60" />
                <span className="text-white">{shop?.language || 'Language'}</span>
              </div>
              <Select value={language} onValueChange={(val) => setLanguage(val as any)}>
                <SelectTrigger className="w-32 bg-white/5 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notifications */}
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-white/60" />
                <span className="text-white">{shop?.notifications || 'Notifications'}</span>
              </div>
              <Switch 
                checked={notifications} 
                onCheckedChange={setNotifications}
              />
            </div>
          </motion.section>

          {/* Help & Legal Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mb-4"
          >
            <Link
              to="/knowledge-base"
              className="flex items-center justify-between px-5 py-4 border-b border-white/10 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <HelpCircle className="h-5 w-5 text-white/60" />
                <span className="text-white">{shop?.helpCenter || 'Help Center'}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-white/40" />
            </Link>

            <Link
              to="/privacy"
              className="flex items-center justify-between px-5 py-4 border-b border-white/10 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-white/60" />
                <span className="text-white">{shop?.privacy || 'Privacy Policy'}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-white/40" />
            </Link>

            <Link
              to="/terms"
              className="flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-white/60" />
                <span className="text-white">{shop?.terms || 'Terms of Service'}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-white/40" />
            </Link>
          </motion.section>

          {/* Logout */}
          {user && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Button
                onClick={handleSignOut}
                variant="ghost"
                className="w-full bg-white/5 border border-white/10 rounded-2xl text-red-400 hover:text-red-300 hover:bg-red-400/10 py-4 h-auto"
              >
                <LogOut className="h-5 w-5 mr-2" />
                {shop?.logout || 'Log Out'}
              </Button>
            </motion.section>
          )}

          {/* Version */}
          <div className="text-center py-6">
            <p className="text-xs text-white/30">
              AfriShop v1.0.0
            </p>
          </div>
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
