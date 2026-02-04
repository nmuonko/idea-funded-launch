import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AdminThemeProvider } from "@/contexts/AdminThemeContext";
import { ShopCartProvider } from "@/contexts/ShopCartContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRouteGuard } from "@/components/admin/AdminRouteGuard";
import { LanguagePreferenceModal } from "@/components/LanguagePreferenceModal";
import { SupabaseConfigGuard } from "@/components/SupabaseConfigGuard";
import SplashScreen from "@/components/SplashScreen";
import Index from "./pages/Index";
import PublicBankTransfer from "./pages/PublicBankTransfer";
import BankTransfer from "./pages/BankTransfer";
import ManualTransfer from "./pages/ManualTransfer";
import Auth from "./pages/Auth";
import AuthCallback from "./pages/AuthCallback";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import Support from "./pages/Support";
import NotFound from "./pages/NotFound";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminOrders from "./pages/admin/Orders";
import AdminOrderDetail from "./pages/admin/OrderDetail";
import AdminFeesSettings from "./pages/admin/FeesSettings";
import AdminUsers from "./pages/admin/Users";
import AdminCustomers from "./pages/admin/Customers";
import AdminShipping from "./pages/admin/Shipping";
import AdminShippingTypes from "./pages/admin/ShippingTypes";
import AdminAnalytics from "./pages/admin/Analytics";
import AdminPayments from "./pages/admin/Payments";
import AdminSupportInbox from "./pages/admin/SupportInbox";
import TicketAnalytics from "./pages/admin/TicketAnalytics";
import KnowledgeBase from "./pages/KnowledgeBase";
import AdminKnowledgeBase from "./pages/admin/KnowledgeBase";
import CartsManagement from "./pages/admin/CartsManagement";
import ABTestResults from "./pages/admin/ABTestResults";
import ThemeSettings from "./pages/admin/ThemeSettings";
import AdminAccessDenied from "./pages/admin/AccessDenied";
import AuditLog from "./pages/admin/AuditLog";
import QuoteRequests from "./pages/admin/QuoteRequests";
import PriceConfirmations from "./pages/admin/PriceConfirmations";
import TransferProofs from "./pages/admin/TransferProofs";
import AdminHealth from "./pages/admin/Health";
import BankTransferSettings from "./pages/admin/BankTransferSettings";
import CacheSettings from "./pages/admin/CacheSettings";
import CatalogSourcesSettings from "./pages/admin/CatalogSourcesSettings";
import CarsSettings from "./pages/admin/CarsSettings";
import HomeCuration from "./pages/admin/HomeCuration";
import Cars from "./pages/Cars";

import PaymentsSettings from "./pages/admin/PaymentsSettings";
import ServiceZones from "./pages/admin/ServiceZones";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import MaishaCallback from "./pages/MaishaCallback";
import MaishapayCheckout from "./pages/MaishapayCheckout";
import MaishapayResult from "./pages/MaishapayResult";
import AcceptInvite from "./pages/AcceptInvite";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFail from "./pages/PaymentFail";
import PaymentCallback from "./pages/PaymentCallback";
import TrackOrder from "./pages/TrackOrder";
import EmailConfirmed from "./pages/EmailConfirmed";
import BankTransferInfo from "./pages/BankTransferInfo";
import HowItWorks from "./pages/HowItWorks";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import PaymentsCompliance from "./pages/PaymentsCompliance";
import Refunds from "./pages/Refunds";
import Payouts from "./pages/Payouts";
import About from "./pages/About";
import Contact from "./pages/Contact";
import DownloadPage from "./pages/Download";
import Coverage from "./pages/Coverage";
import DeleteAccount from "./pages/DeleteAccount";
import { AdminLayout } from "@/components/layout/AdminLayout";

// Shop pages
import ShopHome from "./pages/shop/ShopHome";
import SearchResults from "./pages/shop/SearchResults";
import ProductDetails from "./pages/shop/ProductDetails";
import ShopCart from "./pages/shop/ShopCart";
import Checkout from "./pages/shop/Checkout";
import SavedItems from "./pages/shop/SavedItems";
import MyShopOrders from "./pages/shop/MyOrders";
import ShopAccount from "./pages/shop/Account";
import ShopAuth from "./pages/shop/ShopAuth";
import Onboarding from "./pages/shop/Onboarding";

const queryClient = new QueryClient();

const App = () => {
  // Skip splash for public pages - only show for admin routes
  const [showSplash, setShowSplash] = useState(() => {
    const path = window.location.pathname;
    const publicPaths = ['/', '/how-it-works', '/coverage', '/privacy', '/terms', '/payments-compliance', '/refunds', '/download', '/email-confirmed', '/knowledge-base', '/track-order', '/delete-account', '/about', '/payouts', '/contact', '/shop'];
    return !publicPaths.some(p => path === p || path.startsWith('/bank-transfer') || path.startsWith('/manual-transfer') || path.startsWith('/maishapay') || path.startsWith('/payment') || path.startsWith('/shop'));
  });

  return (
    <SupabaseConfigGuard>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <ShopCartProvider>
              <TooltipProvider>
                <LanguagePreferenceModal />
                <Toaster />
              <Sonner />
              <BrowserRouter>
          <Routes>
            <Route path="/" element={<HowItWorks />} />
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
            <Route path="/download" element={<DownloadPage />} />
            <Route path="/cars" element={<Cars />} />
            
            {/* Shop Routes */}
            <Route path="/shop" element={<ShopHome />} />
            <Route path="/shop/auth" element={<ShopAuth />} />
            <Route path="/shop/onboarding" element={<Onboarding />} />
            <Route path="/shop/search" element={<SearchResults />} />
            <Route path="/shop/product/:provider/:id" element={<ProductDetails />} />
            <Route path="/shop/cart" element={<ShopCart />} />
            <Route path="/shop/saved" element={<SavedItems />} />
            <Route path="/shop/orders" element={<MyShopOrders />} />
            <Route path="/shop/account" element={<ShopAccount />} />
            <Route path="/shop/checkout" element={
              <ProtectedRoute>
                <Checkout />
              </ProtectedRoute>
            } />
            
            <Route path="/admin-login" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/profile" element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } />
            <Route path="/support" element={
              <ProtectedRoute>
                <Support />
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
            <Route path="/maisha-callback" element={<MaishaCallback />} />
            <Route path="/maishapay/checkout" element={<MaishapayCheckout />} />
            <Route path="/maishapay/result" element={<MaishapayResult />} />
            <Route path="/track-order" element={<TrackOrder />} />
            <Route path="/email-confirmed" element={<EmailConfirmed />} />
            <Route path="/payment/success" element={<PaymentSuccess />} />
            <Route path="/payment/fail" element={<PaymentFail />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
            <Route path="/payment-fail" element={<PaymentFail />} />
            <Route path="/payment-callback" element={<PaymentCallback />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/bank-transfer" element={<PublicBankTransfer />} />
            <Route path="/bank-transfer-legacy" element={<BankTransfer />} />
            <Route path="/bank-transfer-info" element={<BankTransferInfo />} />
            <Route path="/manual-transfer/:uploadToken" element={<ManualTransfer />} />
            
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
              <Route path="ticket-analytics" element={
                <AdminRouteGuard requiredPermission="can_view_ticket_analytics">
                  <TicketAnalytics />
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
              <Route path="price-confirmations" element={
                <AdminRouteGuard requiredPermission="can_view_orders">
                  <PriceConfirmations />
                </AdminRouteGuard>
              } />
              <Route path="transfer-proofs" element={
                <AdminRouteGuard requiredPermission="can_view_payments">
                  <TransferProofs />
                </AdminRouteGuard>
              } />
              <Route path="health" element={
                <AdminRouteGuard requiredPermission="can_view_dashboard">
                  <AdminHealth />
                </AdminRouteGuard>
              } />
              <Route path="bank-transfer-settings" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <BankTransferSettings />
                </AdminRouteGuard>
              } />
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
              <Route path="cache-settings" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <CacheSettings />
                </AdminRouteGuard>
              } />
              <Route path="cars-settings" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <CarsSettings />
                </AdminRouteGuard>
              } />
              <Route path="catalog-sources" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <CatalogSourcesSettings />
                </AdminRouteGuard>
              } />
              <Route path="home-curation" element={
                <AdminRouteGuard requiredPermission="can_view_settings">
                  <HomeCuration />
                </AdminRouteGuard>
              } />
              <Route path="access-denied" element={<AdminAccessDenied />} />
          </Route>
            
            <Route path="*" element={<NotFound />} />
          </Routes>
              </BrowserRouter>
              </TooltipProvider>
            </ShopCartProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </SupabaseConfigGuard>
  );
};

export default App;
