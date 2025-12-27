import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AdminThemeProvider } from "@/contexts/AdminThemeContext";
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
import AdminSupportTickets from "./pages/admin/SupportTickets";
import AdminSupportInbox from "./pages/admin/SupportInbox";
import TicketAnalytics from "./pages/admin/TicketAnalytics";
import KnowledgeBase from "./pages/KnowledgeBase";
import AdminKnowledgeBase from "./pages/admin/KnowledgeBase";
import AdminCarts from "./pages/admin/Carts";
import AdminSavedCarts from "./pages/admin/SavedCarts";
import ABTestResults from "./pages/admin/ABTestResults";
import ThemeSettings from "./pages/admin/ThemeSettings";
import AdminAccessDenied from "./pages/admin/AccessDenied";
import AuditLog from "./pages/admin/AuditLog";
import QuoteRequests from "./pages/admin/QuoteRequests";
import TransferProofs from "./pages/admin/TransferProofs";
import AdminHealth from "./pages/admin/Health";
import BankTransferSettings from "./pages/admin/BankTransferSettings";
import BankTransferSubmissions from "./pages/admin/BankTransferSubmissions";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import MaishaCallback from "./pages/MaishaCallback";
import MaishapayCheckout from "./pages/MaishapayCheckout";
import MaishapayResult from "./pages/MaishapayResult";
import AcceptInvite from "./pages/AcceptInvite";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFail from "./pages/PaymentFail";
import TrackOrder from "./pages/TrackOrder";
import EmailConfirmed from "./pages/EmailConfirmed";
import BankTransferInfo from "./pages/BankTransferInfo";
import { AdminLayout } from "@/components/layout/AdminLayout";

const queryClient = new QueryClient();

const App = () => {
  // Skip splash for public pages like email confirmation
  const [showSplash, setShowSplash] = useState(() => {
    return !window.location.pathname.includes('/email-confirmed');
  });

  return (
    <SupabaseConfigGuard>
      {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <TooltipProvider>
              <LanguagePreferenceModal />
              <Toaster />
              <Sonner />
              <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
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
                  <AdminCarts />
                </AdminRouteGuard>
              } />
              <Route path="saved-carts" element={
                <AdminRouteGuard requiredPermission="can_view_saved_carts">
                  <AdminSavedCarts />
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
              <Route path="support" element={
                <AdminRouteGuard requiredPermission="can_view_tickets">
                  <AdminSupportTickets />
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
              <Route path="bank-transfer-submissions" element={
                <AdminRouteGuard requiredPermission="can_view_payments">
                  <BankTransferSubmissions />
                </AdminRouteGuard>
              } />
              <Route path="access-denied" element={<AdminAccessDenied />} />
          </Route>
            
            <Route path="*" element={<NotFound />} />
          </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </SupabaseConfigGuard>
  );
};

export default App;
