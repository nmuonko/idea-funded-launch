import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import AdminAnalytics from "./pages/admin/Analytics";
import AdminPayments from "./pages/admin/Payments";
import AdminSupportTickets from "./pages/admin/SupportTickets";
import TicketAnalytics from "./pages/admin/TicketAnalytics";
import KnowledgeBase from "./pages/KnowledgeBase";
import AdminKnowledgeBase from "./pages/admin/KnowledgeBase";
import AdminCarts from "./pages/admin/Carts";
import ABTestResults from "./pages/admin/ABTestResults";
import Orders from "./pages/Orders";
import MaishaCallback from "./pages/MaishaCallback";
import { AdminLayout } from "@/components/layout/AdminLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
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
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin>
                <AdminLayout />
              </ProtectedRoute>
            }>
              <Route index element={<AdminDashboard />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="orders/:id" element={<AdminOrderDetail />} />
              <Route path="carts" element={<AdminCarts />} />
              <Route path="ab-tests" element={<ABTestResults />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="support" element={<AdminSupportTickets />} />
              <Route path="ticket-analytics" element={<TicketAnalytics />} />
              <Route path="knowledge-base" element={<AdminKnowledgeBase />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="shipping" element={<AdminShipping />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="settings" element={<AdminFeesSettings />} />
            </Route>
            
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
