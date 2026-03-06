import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Eye, EyeOff, Loader2, Mail, Lock, User, Phone, Check, MapPin, Building, Globe, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, translations } from '@/lib/i18n/translations';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import afrishopLogo from '@/assets/afrishop-logo.png';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type AuthMode = 'welcome' | 'signin' | 'signup' | 'forgot' | 'verify';

export default function ShopAuth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';
  const { signIn, signUp, user, checkAdminStatus } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { toast } = useToast();
  
  const [mode, setMode] = useState<AuthMode>('welcome');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [country] = useState('DR Congo'); // Prefilled and locked
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const t = translations[language] || translations.en;
  const auth = (t as any).auth || {};
  const common = t.common as Record<string, string>;
  const currentLanguage = languages.find(l => l.code === language) || languages[0];

  // DRC Provinces
  const drcProvinces = [
    'Kinshasa',
    'Kongo-Central',
    'Kwango',
    'Kwilu',
    'Mai-Ndombe',
    'Kasaï',
    'Kasaï-Central',
    'Kasaï-Oriental',
    'Lomami',
    'Sankuru',
    'Maniema',
    'Sud-Kivu',
    'Nord-Kivu',
    'Ituri',
    'Haut-Uele',
    'Tshopo',
    'Bas-Uele',
    'Nord-Ubangi',
    'Mongala',
    'Sud-Ubangi',
    'Équateur',
    'Tshuapa',
    'Tanganyika',
    'Haut-Lomami',
    'Lualaba',
    'Haut-Katanga',
  ];

  // Redirect if already logged in
  if (user) {
    navigate(redirect, { replace: true });
    return null;
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast({
        title: auth.errors?.emailRequired || 'Email is required',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error, userId } = await signIn(email, password, rememberMe);
      
      if (error) {
        // If email not confirmed, redirect to verification screen
        if (error.message?.includes('Email not confirmed')) {
          setMode('verify');
          return;
        }
        // Other errors already handled by AuthContext toast
        return;
      }
      
      toast({
        title: auth.signInSuccess || 'Welcome back!',
      });
      
      // Check if user is admin and redirect accordingly
      if (userId) {
        try {
          const isAdminUser = await checkAdminStatus(userId);
          if (isAdminUser) {
            navigate('/admin', { replace: true });
            return;
          }
        } catch (e) {
          // Non-admin user, continue to shop
        }
      }
      navigate(redirect || '/', { replace: true });
    } catch (error: any) {
      console.error('Sign in error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fullName || fullName.length < 2) {
      toast({
        title: auth.errors?.nameRequired || 'Full name is required',
        variant: 'destructive',
      });
      return;
    }

    if (!email) {
      toast({
        title: auth.errors?.emailRequired || 'Email is required',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: auth.errors?.passwordTooShort || 'Password must be at least 8 characters',
        variant: 'destructive',
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: auth.errors?.passwordMismatch || 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    if (!phone || phone.length < 9) {
      toast({
        title: auth.errors?.phoneRequired || 'Phone number is required for mobile payments',
        variant: 'destructive',
      });
      return;
    }

    if (!city) {
      toast({
        title: auth.errors?.cityRequired || 'City is required for shipping',
        variant: 'destructive',
      });
      return;
    }

    if (!province) {
      toast({
        title: auth.errors?.provinceRequired || 'Province is required for shipping',
        variant: 'destructive',
      });
      return;
    }

    if (!termsAccepted) {
      toast({
        title: auth.errors?.termsRequired || 'Please accept the terms and conditions',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await signUp(email, password, fullName, phone, {
        country,
        city,
        province,
        address_line1: addressLine1,
      });
      
      setMode('verify');
    } catch (error: any) {
      console.error('Sign up error:', error);
      toast({
        title: error.message || auth.errors?.genericError || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast({
        title: auth.errors?.emailRequired || 'Email is required',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      
      if (error) throw error;
      
      toast({
        title: auth.resetLinkSent || 'Reset link sent! Check your email.',
      });
      setMode('signin');
    } catch (error: any) {
      console.error('Reset password error:', error);
      toast({
        title: error.message || auth.errors?.genericError || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

   const handleResendVerification = async () => {
    setLoading(true);
    try {
      const response = await supabase.functions.invoke('auth-service', {
        body: {
          action: 'resend_verification',
          email,
          redirectBaseUrl: window.location.origin,
        },
      });
      
      if (response.error) throw response.error;
      const result = response.data;
      if (result && !result.ok) throw new Error(result.message);
      
      toast({
        title: auth.verificationResent || 'Verification email resent!',
      });
    } catch (error: any) {
      console.error('Resend verification error:', error);
      toast({
        title: error.message || auth.errors?.genericError || 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center justify-between">
        {mode !== 'welcome' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode('welcome')}
            className="text-white/70 hover:text-white hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t.common?.back || 'Back'}
          </Button>
        ) : (
          <div />
        )}
        
        {/* Language Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/70 hover:text-white hover:bg-white/10 rounded-full gap-1"
            >
              <Globe className="h-4 w-4" />
              <span>{currentLanguage.flag}</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-black/95 border-white/10 backdrop-blur-xl">
            {languages.map((lang) => (
              <DropdownMenuItem
                key={lang.code}
                onClick={() => setLanguage(lang.code)}
                className={`text-white/80 hover:text-white hover:bg-white/10 cursor-pointer ${
                  language === lang.code ? 'bg-blue-500/20 text-blue-400' : ''
                }`}
              >
                <span className="mr-2">{lang.flag}</span>
                {lang.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <AnimatePresence mode="wait">
          {/* Welcome Screen */}
          {mode === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-sm text-center space-y-8"
            >
              <div className="space-y-4">
                <img src={afrishopLogo} alt="AfriShop" className="h-16 mx-auto brightness-0 invert" />
                <h1 className="text-2xl font-bold text-white">
                  {auth.welcome || 'Welcome to AfriShop'}
                </h1>
                <p className="text-white/60">
                  {auth.tagline || 'Shop USA, Deliver to DRC'}
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={() => setMode('signup')}
                  className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-base"
                >
                  {auth.createAccount || 'Create Account'}
                </Button>
                
                <Button
                  onClick={() => setMode('signin')}
                  variant="outline"
                  className="w-full h-12 border-white/20 text-white hover:bg-white/10 rounded-full text-base"
                >
                  {auth.signIn || 'Sign In'}
                </Button>
              </div>

              <Link
                to="/shop"
                className="block text-white/60 hover:text-white transition-colors text-sm"
              >
                {auth.continueAsGuest || 'Continue as Guest'} →
              </Link>
            </motion.div>
          )}

          {/* Sign In Screen */}
          {mode === 'signin' && (
            <motion.form
              key="signin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              onSubmit={handleSignIn}
              className="w-full max-w-sm space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-white">{auth.signIn || 'Sign In'}</h2>
                <p className="text-white/60 text-sm">{auth.signInSubtitle || 'Welcome back!'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="email" className="text-white/70">{auth.email || 'Email'}</Label>
                  <div className="relative mt-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="pl-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="password" className="text-white/70">{auth.password || 'Password'}</Label>
                  <div className="relative mt-1">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-10 pr-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {auth.forgotPassword || 'Forgot Password?'}
                </button>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="rememberMe"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                    className="border-white/30 data-[state=checked]:bg-blue-500"
                  />
                  <label
                    htmlFor="rememberMe"
                    className="text-sm text-white/60 cursor-pointer"
                  >
                    {auth.rememberMe || 'Remember me'}
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-base"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : auth.signIn || 'Sign In'}
              </Button>

              <p className="text-center text-white/60 text-sm">
                {auth.noAccount || "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={() => setMode('signup')}
                  className="text-blue-400 hover:text-blue-300"
                >
                  {auth.createAccount || 'Create Account'}
                </button>
              </p>
            </motion.form>
          )}

          {/* Sign Up Screen */}
          {mode === 'signup' && (
            <motion.form
              key="signup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              onSubmit={handleSignUp}
              className="w-full max-w-sm space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-white">{auth.createAccount || 'Create Account'}</h2>
                <p className="text-white/60 text-sm">{auth.signUpSubtitle || 'Join AfriShop today'}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="fullName" className="text-white/70">{auth.fullName || 'Full Name'}</Label>
                  <div className="relative mt-1">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="John Doe"
                      className="pl-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="signupEmail" className="text-white/70">{auth.email || 'Email'}</Label>
                  <div className="relative mt-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="signupEmail"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="pl-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="phone" className="text-white/70">{auth.phone || 'Phone Number'} *</Label>
                  <div className="relative mt-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+243 XXX XXX XXX"
                      className="pl-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                  </div>
                  <p className="text-xs text-white/40 mt-1">{auth.phoneNote || 'Required for mobile payment (M-Pesa, Orange Money, Airtel Money)'}</p>
                </div>

                {/* Shipping Address Section */}
                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs text-white/50 mb-3">{auth.shippingInfo || 'Shipping Information'}</p>
                </div>

                <div>
                  <Label htmlFor="addressLine1" className="text-white/70">{auth.address || 'Shipping Address'}</Label>
                  <div className="relative mt-1">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="addressLine1"
                      type="text"
                      value={addressLine1}
                      onChange={(e) => setAddressLine1(e.target.value)}
                      placeholder="123 Avenue de la Paix"
                      className="pl-10 bg-white/5 border-white/10 text-white h-12"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="city" className="text-white/70">{auth.city || 'City'} *</Label>
                  <div className="relative mt-1">
                    <Building className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Kinshasa"
                      className="pl-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="province" className="text-white/70">{auth.province || 'Province'} *</Label>
                  <Select value={province} onValueChange={setProvince}>
                    <SelectTrigger className="h-12 bg-white/5 border-white/10 text-white">
                      <SelectValue placeholder={auth.selectProvince || 'Select province'} />
                    </SelectTrigger>
                    <SelectContent className="bg-black/95 border-white/10 backdrop-blur-xl max-h-60">
                      {drcProvinces.map((prov) => (
                        <SelectItem 
                          key={prov} 
                          value={prov}
                          className="text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          {prov}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="country" className="text-white/70">{auth.country || 'Country'}</Label>
                  <div className="relative mt-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="country"
                      type="text"
                      value={country}
                      disabled
                      className="pl-10 bg-white/5 border-white/10 text-white/60 h-12 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-white/40 mt-1">{auth.countryNote || 'Currently shipping to DRC only'}</p>
                </div>

                <div>
                  <Label htmlFor="signupPassword" className="text-white/70">{auth.password || 'Password'}</Label>
                  <div className="relative mt-1">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="signupPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-10 pr-10 bg-white/5 border-white/10 text-white h-12"
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-white/40 mt-1">{auth.passwordHint || 'Must be at least 8 characters'}</p>
                </div>

                <div>
                  <Label htmlFor="confirmPassword" className="text-white/70">{auth.confirmPassword || 'Confirm Password'}</Label>
                  <div className="relative mt-1">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-10 pr-10 bg-white/5 border-white/10 text-white h-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="terms"
                    checked={termsAccepted}
                    onCheckedChange={(checked) => setTermsAccepted(checked as boolean)}
                    className="mt-1 border-white/40"
                  />
                  <label htmlFor="terms" className="text-sm text-white/70 cursor-pointer">
                    {auth.termsAgree || 'I agree to the'}{' '}
                    <Link to="/terms" className="text-blue-400 hover:underline">
                      {common.terms || 'Terms of Service'}
                    </Link>{' '}
                    {common.and || 'and'}{' '}
                    <Link to="/privacy" className="text-blue-400 hover:underline">
                      {common.privacy || 'Privacy Policy'}
                    </Link>
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-base"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : auth.createAccount || 'Create Account'}
              </Button>

              <p className="text-center text-white/60 text-sm">
                {auth.hasAccount || 'Already have an account?'}{' '}
                <button
                  type="button"
                  onClick={() => setMode('signin')}
                  className="text-blue-400 hover:text-blue-300"
                >
                  {auth.signIn || 'Sign In'}
                </button>
              </p>
            </motion.form>
          )}

          {/* Forgot Password Screen */}
          {mode === 'forgot' && (
            <motion.form
              key="forgot"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              onSubmit={handleForgotPassword}
              className="w-full max-w-sm space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-white">{auth.resetPassword || 'Reset Password'}</h2>
                <p className="text-white/60 text-sm">
                  {auth.resetPasswordSubtitle || "Enter your email and we'll send you a reset link."}
                </p>
              </div>

              <div>
                <Label htmlFor="resetEmail" className="text-white/70">{auth.email || 'Email'}</Label>
                <div className="relative mt-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <Input
                    id="resetEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="pl-10 bg-white/5 border-white/10 text-white h-12"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-base"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : auth.sendResetLink || 'Send Reset Link'}
              </Button>

              <button
                type="button"
                onClick={() => setMode('signin')}
                className="block w-full text-center text-white/60 hover:text-white text-sm"
              >
                ← {auth.backToSignIn || 'Back to Sign In'}
              </button>
            </motion.form>
          )}

          {/* Email Verification Screen */}
          {mode === 'verify' && (
            <motion.div
              key="verify"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-sm text-center space-y-6"
            >
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto">
                <Mail className="h-8 w-8 text-blue-400" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">{auth.verifyEmail || 'Check your email'}</h2>
                <p className="text-white/60">
                  {auth.verifyEmailSent || 'We sent a verification link to'}{' '}
                  <span className="text-white">{email}</span>
                </p>
              </div>

              <Button
                onClick={handleResendVerification}
                disabled={loading}
                variant="outline"
                className="w-full h-12 border-white/20 text-white hover:bg-white/10 rounded-full"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : auth.resendVerification || 'Resend Verification'}
              </Button>

              <p className="text-sm text-white/50">
                {auth.checkSpam || "Check your spam folder if you don't see it"}
              </p>

              <button
                onClick={() => setMode('signin')}
                className="text-white/60 hover:text-white text-sm"
              >
                ← {auth.backToSignIn || 'Back to Sign In'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
