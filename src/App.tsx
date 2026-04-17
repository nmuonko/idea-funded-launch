import { useState, lazy, Suspense } from "react";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";

// Helper component for legacy /shop/product redirects
function ShopProductRedirect() {
  const { provider, id } = useParams();
  return <Navigate to={`/product/${provider}/${id}`} replace />;
}
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AdminThemeProvider } from "@/contexts/AdminThemeContext";
import { ShopCartProvider } from "@/contexts/ShopCartContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ShopProtectedRoute } from "@/components/shop/ShopProtectedRoute";
import { AdminRouteGuard } from "@/components/admin/AdminRouteGuard";
import { LanguagePreferenceModal } from "@/components/LanguagePreferenceModal";
import { SupabaseConfigGuard } from "@/components/SupabaseConfigGuard";
import SplashScreen from "@/components/SplashScreen";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AuthCallback from "./pages/AuthCallback";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

// Lazy-loaded admin pages
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminOrders = lazy(() => import("./pages/admin/Orders"));
const AdminOrderDetail = lazy(() => import("./pages/admin/OrderDetail"));
const AdminFeesSettings = lazy(() => import("./pages/admin/FeesSettings"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminCustomers = lazy(() => import("./pages/admin/Customers"));
const AdminShipping = lazy(() => import("./pages/admin/Shipping"));
const AdminShippingTypes = lazy(() => import("./pages/admin/ShippingTypes"));
const AdminAnalytics = lazy(() => import("./pages/admin/Analytics"));
const DemandInsights = lazy(() => import("./pages/admin/DemandInsights"));
const AdminPayments = lazy(() => import("./pages/admin/Payments"));
const AdminSupportInbox = lazy(() => import("./pages/admin/SupportInbox"));
const SupportContactSettings = lazy(() => import("./pages/admin/SupportContactSettings"));
const ChatRouting = lazy(() => import("./pages/admin/ChatRouting"));
const AdminKnowledgeBase = lazy(() => import("./pages/admin/KnowledgeBase"));
const CartsManagement = lazy(() => import("./pages/admin/CartsManagement"));
const ABTestResults = lazy(() => import("./pages/admin/ABTestResults"));
const ThemeSettings = lazy(() => import("./pages/admin/ThemeSettings"));
const AdminAccessDenied = lazy(() => import("./pages/admin/AccessDenied"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const QuoteRequests = lazy(() => import("./pages/admin/QuoteRequests"));
const AdminHealth = lazy(() => import("./pages/admin/Health"));
const CatalogSourcesSettings = lazy(() => import("./pages/admin/CatalogSourcesSettings"));
const HomeRecipes = lazy(() => import("./pages/admin/HomeRecipes"));
const CatalogCache = lazy(() => import("./pages/admin/CatalogCache"));
const AutoLearning = lazy(() => import("./pages/admin/AutoLearning"));
const AdminReferrals = lazy(() => import("./pages/admin/Referrals"));
const PaymentsSettings = lazy(() => import("./pages/admin/PaymentsSettings"));
const ServiceZones = lazy(() => import("./pages/admin/ServiceZones"));
const AdminDelivery = lazy(() => import("./pages/admin/Delivery"));
const AdminHotProducts = lazy(() => import("./pages/admin/HotProducts"));
const AdminBundleLinks = lazy(() => import("./pages/admin/BundleLinks"));
const AdminInternationalProducts = lazy(() => import("./pages/admin/InternationalProducts"));
const AdminCountryShippingRates = lazy(() => import("./pages/admin/CountryShippingRates"));
const CountryShop = lazy(() => import("./pages/shop/CountryShop"));

// Lazy-loaded secondary pages
const Cars = lazy(() => import("./pages/Cars"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const About = lazy(() => import("./pages/About"));
const Coverage = lazy(() => import("./pages/Coverage"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const PaymentsCompliance = lazy(() => import("./pages/PaymentsCompliance"));
const Refunds = lazy(() => import("./pages/Refunds"));
const Payouts = lazy(() => import("./pages/Payouts"));
const Contact = lazy(() => import("./pages/Contact"));
const DownloadPage = lazy(() => import("./pages/Download"));
const GetApp = lazy(() => import("./pages/GetApp"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const ShareAndEarn = lazy(() => import("./pages/shop/ShareAndEarn"));

import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFail from "./pages/PaymentFail";
import PaymentCallback from "./pages/PaymentCallback";
import TrackOrder from "./pages/TrackOrder";
import EmailConfirmed from "./pages/EmailConfirmed";

import { AdminLayout } from "@/components/layout/AdminLayout";
import { FloatingContactWidget } from "@/components/shop/FloatingContactWidget";
 import { SupportChatProvider } from "@/contexts/SupportChatContext";

// Shop pages — eagerly loaded (primary user flow)
import ShopHome from "./pages/shop/ShopHome";
import CategoryResultsPage from "./pages/shop/CategoryResultsPage";
import SearchResults from "./pages/shop/SearchResults";
import ProductDetails from "./pages/shop/ProductDetails";
import { ProductDetailErrorBoundary } from "@/components/shop/ProductDetailErrorBoundary";
import ShopCart from "./pages/shop/ShopCart";
import Checkout from "./pages/shop/Checkout";
import SavedItems from "./pages/shop/SavedItems";
import MyShopOrders from "./pages/shop/MyOrders";
import ShopAccount from "./pages/shop/Account";
import ShopAuth from "./pages/shop/ShopAuth";
import Onboarding from "./pages/shop/Onboarding";
import PaymentPending from "./pages/shop/PaymentPending";
import CardPayment from "./pages/shop/CardPayment";
import PasteLink from "./pages/shop/PasteLink";
import ShopPaymentSuccess from "./pages/shop/PaymentSuccess";
import HotProducts from "./pages/shop/HotProducts";
import HotProductBuy from "./pages/shop/HotProductBuy";
const HotProductShare = lazy(() => import("./pages/share/HotProductShare"));
const BundleShare = lazy(() => import("./pages/share/BundleShare"));

// Suspense fallback for lazy-loaded routes
function LazyFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,  // 2 minutes — reuse cached data on re-mount
      gcTime: 1000 * 60 * 10,    // 10 minutes — keep inactive queries in memory
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  // Skip splash for public pages - only show for admin routes
  const [showSplash, setShowSplash] = useState(() => {
    const path = window.location.pathname;
    const publicPaths = ['/', '/how-it-works', '/coverage', '/privacy', '/terms', '/payments-compliance', '/refunds', '/download', '/get', '/email-confirmed', '/knowledge-base', '/track-order', '/delete-account', '/about', '/payouts', '/contact', '/browse', '/cart', '/checkout', '/saved', '/my-orders', '/account', '/search', '/product', '/shop-auth', '/onboarding', '/payment-pending', '/card-payment', '/payment-success-shop', '/paste-link', '/hot-products', '/share', '/bundle'];
    return !publicPaths.some(p => path === p || path.startsWith('/payment') || path.startsWith('/browse') || path.startsWith('/product') || path.startsWith('/search') || path.startsWith('/cart') || path.startsWith('/checkout') || path.startsWith('/saved') || path.startsWith('/my-orders') || path.startsWith('/account') || path.startsWith('/shop') || path.startsWith('/get') || path.startsWith('/paste-link') || path.startsWith('/hot-products') || path.startsWith('/share') || path.startsWith('/bundle'));
  });

  return (
    <GlobalErrorBoundary>
    <SupabaseConfigGuard>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <ShopCartProvider>
               <SupportChatProvider>
                 <TooltipProvider>
                <LanguagePreferenceModal />
                <Toaster />
                   <Sonner />
                   <BrowserRouter>
                     {/* Global floating contact widget for shop */}
                     <FloatingContactWidget />
                     <Suspense fallback={<LazyFallback />}>
          <Routes>
        <Route path="/" element={<ShopHome />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/about" element={<About />} />
            <Route path="/coverage" element={<Coverage />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/payments-compliance" element={<PaymentsCompliance />} />
            <Route path="/refunds" element={<Refunds />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/delete-account" element={<DeleteAccount />} />
            <Route path="/get" element={<GetApp />} />
            <Route path="/download" element={<Navigate to="/get" replace />} />
            <Route path="/cars" element={<Cars />} />
            <Route path="/share" element={<ShareAndEarn />} />
            
            {/* Legacy /browse redirect */}
            <Route path="/browse" element={<Navigate to="/" replace />} />
            <Route path="/shop-auth" element={<ShopAuth />} />
            <Route path="/shop-auth/login" element={<Navigate to="/shop-auth" replace />} />
            <Route path="/shop-auth/register" element={<Navigate to="/shop-auth" replace />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/category/:key" element={<CategoryResultsPage />} />
            <Route path="/product/:provider/:id" element={<ProductDetailErrorBoundary><ProductDetails /></ProductDetailErrorBoundary>} />
            <Route path="/cart" element={<ShopCart />} />
            <Route path="/paste-link" element={<PasteLink />} />
            <Route path="/hot-products" element={<HotProducts />} />
            <Route path="/hot-products/:id" element={<HotProductBuy />} />
            <Route path="/share/hp/:id" element={<HotProductShare />} />
            <Route path="/bundle/:bundleId" element={<BundleShare />} />
            <Route path="/saved" element={<SavedItems />} />
            <Route path="/my-orders" element={
              <ShopProtectedRoute>
                <MyShopOrders />
              </ShopProtectedRoute>
            } />
            <Route path="/account" element={<ShopAccount />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/payment-pending" element={<PaymentPending />} />
            <Route path="/card-payment" element={
              <ShopProtectedRoute>
                <CardPayment />
              </ShopProtectedRoute>
            } />
            <Route path="/payment-success-shop" element={<ShopPaymentSuccess />} />
            
            {/* Legacy /shop redirects for compatibility */}
            <Route path="/shop" element={<Navigate to="/" replace />} />
            <Route path="/shop/auth" element={<Navigate to="/shop-auth" replace />} />
            <Route path="/shop/cart" element={<Navigate to="/cart" replace />} />
            <Route path="/shop/saved" element={<Navigate to="/saved" replace />} />
            <Route path="/shop/orders" element={<Navigate to="/my-orders" replace />} />
            <Route path="/shop/account" element={<Navigate to="/account" replace />} />
            <Route path="/shop/checkout" element={<Navigate to="/checkout" replace />} />
            <Route path="/shop/search" element={<Navigate to="/search" replace />} />
            <Route path="/shop/product/:provider/:id" element={<ShopProductRedirect />} />

            {/* Country-specific shop pages (China, Dubai, Turkey) */}
            <Route path="/shop/:country" element={<CountryShop />} />
            
            <Route path="/admin-login" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            <Route path="/orders" element={
              <ProtectedRoute>
                <Orders />
              </ProtectedRoute>
            } />
            <Route path="/orders/:id" element={
              <ProtectedRoute>
                <OrderDetail />
              </ProtectedRoute>
            } />
            <Route path="/track-order" element={<TrackOrder />} />
            <Route path="/email-confirmed" element={<EmailConfirmed />} />
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/fail" element={<PaymentFail />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
            <Route path="/payment-fail" element={<PaymentFail />} />
            <Route path="/payment-callback" element={<PaymentCallback />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin>
                <AdminThemeProvider>
                  <AdminLayout />
                </AdminThemeProvider>
              </ProtectedRoute>
            }>
              <Route index element={
                <AdminRouteGuard requiredPermission="can_view_dashboard">
                  <AdminDashboard />
                </AdminRouteGuard>
              } />
              <Route path="orders" element={
                <AdminRouteGuard requiredPermission="can_view_orders">
                  <AdminOrders />
                </AdminRouteGuard>
              } />
              <Route path="orders/:id" element={
                <AdminRouteGuard requiredPermission="can_view_orders">
                  <AdminOrderDetail />
                </AdminRouteGuard>
              } />
              <Route path="carts" element={
                <AdminRouteGuard requiredPermission="can_view_active_carts">
                  <CartsManagement />
                </AdminRouteGuard>
              } />
              <Route path="ab-tests" element={
                <AdminRouteGuard requiredPermission="can_view_ab_results">
                  <ABTestResults />
                </AdminRouteGuard>
              } />
              <Route path="payments" element={
                <AdminRouteGuard requiredPermission="can_view_payments">
                  <AdminPayments />
                </AdminRouteGuard>
              } />
              <Route path="support-inbox" element={
                <AdminRouteGuard requiredPermission="can_view_tickets">
                  <AdminSupportInbox />
                </AdminRouteGuard>
              } />
              <Route path="chat-routing" element={
                <AdminRouteGuard requiredPermission="can_view_ticket_analytics">
                  <ChatRouting />
                </AdminRouteGuard>
              } />
              <Route path="support-contact" element={
                <AdminRouteGuard requiredPermission="can_view_tickets">
                  <SupportContactSettings />
                </AdminRouteGuard>
              } />
              <Route path="knowledge-base" element={
                <AdminRouteGuard requiredPermission="can_view_knowledge_base">
                  <AdminKnowledgeBase />
                </AdminRouteGuard>
              } />
              <Route path="customers" element={
                <AdminRouteGuard requiredPermission="can_view_customers">
                  <AdminCustomers />
                </AdminRouteGuard>
              } />
              <Route path="users" element={
                <AdminRouteGuard requiredPermission="can_manage_users">
                  <AdminUsers />
                </AdminRouteGuard>
              } />
              <Route path="shipping" element={
                <AdminRouteGuard requiredPermission="can_view_shipping">
                  <AdminShipping />
                </AdminRouteGuard>
              } />
              <Route path="delivery" element={
                <AdminRouteGuard requiredPermission="can_view_shipping">
                  <AdminDelivery />
                </AdminRouteGuard>
              } />
              <Route path="shipping-types" element={
                <AdminRouteGuard requiredPermission="can_manage_shipping_types">
                  <AdminShippingTypes />
                </AdminRouteGuard>
              } />
              <Route path="analytics" element={
                <AdminRouteGuard requiredPermission="can_view_analytics">
                  <AdminAnalytics />
                </AdminRouteGuard>
              } />
              <Route path="demand-insights" element={
                <AdminRouteGuard requiredPermission="can_view_analytics">
                  <DemandInsights />
                </AdminRouteGuard>
              } />
              <Route path="settings" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <AdminFeesSettings />
                </AdminRouteGuard>
              } />
              <Route path="theme-settings" element={
                <AdminRouteGuard requiredPermission="can_view_theme_settings">
                  <ThemeSettings />
                </AdminRouteGuard>
              } />
              <Route path="audit-log" element={
                <AdminRouteGuard requiredPermission="can_view_dashboard">
                  <AuditLog />
                </AdminRouteGuard>
              } />
              <Route path="quote-requests" element={
                <AdminRouteGuard requiredPermission="can_view_orders">
                  <QuoteRequests />
                </AdminRouteGuard>
              } />
              {/* transfer-proofs and price-confirmations routes removed */}
              <Route path="health" element={
                <AdminRouteGuard requiredPermission="can_view_dashboard">
                  <AdminHealth />
                </AdminRouteGuard>
              } />
              {/* bank-transfer-settings route removed */}
              <Route path="payments-settings" element={
                <AdminRouteGuard requiredPermission="can_view_payments">
                  <PaymentsSettings />
                </AdminRouteGuard>
              } />
              <Route path="service-zones" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <ServiceZones />
                </AdminRouteGuard>
              } />
              {/* cache-settings route removed — merged into catalog-sources */}
              <Route path="catalog-cache" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <CatalogCache />
                </AdminRouteGuard>
              } />
              <Route path="auto-learning" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <AutoLearning />
                </AdminRouteGuard>
              } />
              {/* catalog-builder and cars-settings routes removed */}
              <Route path="catalog-sources" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <CatalogSourcesSettings />
                </AdminRouteGuard>
              } />
              {/* home-curation route removed - consolidated into home-recipes */}
              <Route path="home-recipes" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <HomeRecipes />
                </AdminRouteGuard>
              } />
              {/* search-relevancy route removed */}
              <Route path="referrals" element={
                <AdminRouteGuard requiredPermission="can_view_marketing">
                  <AdminReferrals />
                </AdminRouteGuard>
              } />
              <Route path="hot-products" element={
                <AdminRouteGuard requiredPermission="can_view_marketing">
                  <AdminHotProducts />
                </AdminRouteGuard>
              } />
              <Route path="bundle-links" element={
                <AdminRouteGuard requiredPermission="can_view_marketing">
                  <AdminBundleLinks />
                </AdminRouteGuard>
              } />
              <Route path="international-products" element={
                <AdminRouteGuard requiredPermission="can_view_marketing">
                  <AdminInternationalProducts />
                </AdminRouteGuard>
              } />
              <Route path="country-shipping" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <AdminCountryShippingRates />
                </AdminRouteGuard>
              } />
              <Route path="access-denied" element={<AdminAccessDenied />} />
          </Route>
            
            <Route path="*" element={<NotFound />} />
          </Routes>
                     </Suspense>
              </BrowserRouter>
                 </TooltipProvider>
               </SupportChatProvider>
            </ShopCartProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </SupabaseConfigGuard>
    </GlobalErrorBoundary>
  );
};

export default App;
