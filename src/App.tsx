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
import { LanguagePreferenceModal } from "@/components/LanguagePreferenceModal";
import SplashScreen from "@/components/SplashScreen";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import Support from "./pages/Support";
import NotFound from "./pages/NotFound";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminOrders from "./pages/admin/Orders";
import AdminOrderDetail from "./pages/admin/OrderDetail";
import AdminFeesSettings from "./pages/admin/FeesSettings";
import AdminUsers from "./pages/admin/Users";
import AdminShipping from "./pages/admin/Shipping";
import AdminShippingTypes from "./pages/admin/ShippingTypes";
import AdminAnalytics from "./pages/admin/Analytics";
import AdminPayments from "./pages/admin/Payments";
import AdminSupportTickets from "./pages/admin/SupportTickets";
import TicketAnalytics from "./pages/admin/TicketAnalytics";
import KnowledgeBase from "./pages/KnowledgeBase";
import AdminKnowledgeBase from "./pages/admin/KnowledgeBase";
import AdminCarts from "./pages/admin/Carts";
import AdminSavedCarts from "./pages/admin/SavedCarts";
import ABTestResults from "./pages/admin/ABTestResults";
import ThemeSettings from "./pages/admin/ThemeSettings";
import Orders from "./pages/Orders";
import MaishaCallback from "./pages/MaishaCallback";
import AcceptInvite from "./pages/AcceptInvite";
import { AdminLayout } from "@/components/layout/AdminLayout";

const queryClient = new QueryClient();

const App = () => {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <>
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
            <Route path="/maisha-callback" element={<MaishaCallback />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin>
                <AdminThemeProvider>
                  <AdminLayout />
                </AdminThemeProvider>
              </ProtectedRoute>
            }>
              <Route index element={<AdminDashboard />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="orders/:id" element={<AdminOrderDetail />} />
              <Route path="carts" element={<AdminCarts />} />
              <Route path="saved-carts" element={<AdminSavedCarts />} />
              <Route path="ab-tests" element={<ABTestResults />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="support" element={<AdminSupportTickets />} />
              <Route path="ticket-analytics" element={<TicketAnalytics />} />
              <Route path="knowledge-base" element={<AdminKnowledgeBase />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="shipping" element={<AdminShipping />} />
              <Route path="shipping-types" element={<AdminShippingTypes />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="settings" element={<AdminFeesSettings />} />
              <Route path="theme-settings" element={<ThemeSettings />} />
          </Route>
            
            <Route path="*" element={<NotFound />} />
          </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </>
  );
};

export default App;
