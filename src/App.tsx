import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Chatbot } from "@/components/Chatbot";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import Apply from "./pages/Apply";
import Results from "./pages/Results";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Contact from "./pages/Contact";
import Auth from "./pages/Auth";
import Profile from "./pages/Profile";
import PaymentResult from "./pages/PaymentResult";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminSessions from "./pages/admin/Sessions";
import AdminSubmissions from "./pages/admin/Submissions";
import AdminContacts from "./pages/admin/Contacts";
import PaymentsView from "./pages/admin/PaymentsView";
import SessionSettings from "./pages/admin/SessionSettings";
import ContentManagement from "./pages/admin/ContentManagement";
import AIAssistant from "./pages/admin/AIAssistant";
import Analytics from "./pages/admin/Analytics";
import AdminUsers from "./pages/admin/AdminUsers";
import CommandCenter from "./pages/admin/CommandCenter";
import WinnersManagement from "./pages/admin/WinnersManagement";
import Winners from "./pages/Winners";
import Leaderboard from "./pages/Leaderboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Chatbot />
          <BrowserRouter>
            <Routes>
              {/* Public routes with header/footer */}
              <Route path="/" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Index /></main>
                  <Footer />
                </div>
              } />
              <Route path="/how-it-works" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><HowItWorks /></main>
                  <Footer />
                </div>
              } />
              <Route path="/apply" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Apply /></main>
                  <Footer />
                </div>
              } />
              <Route path="/results" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Results /></main>
                  <Footer />
                </div>
              } />
              <Route path="/winners" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Winners /></main>
                  <Footer />
                </div>
              } />
              <Route path="/leaderboard" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Leaderboard /></main>
                  <Footer />
                </div>
              } />
              <Route path="/terms" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Terms /></main>
                  <Footer />
                </div>
              } />
              <Route path="/privacy" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Privacy /></main>
                  <Footer />
                </div>
              } />
              <Route path="/contact" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Contact /></main>
                  <Footer />
                </div>
              } />
              <Route path="/auth" element={<Auth />} />
              <Route path="/payment/result" element={<PaymentResult />} />
              <Route path="/profile" element={
                <ProtectedRoute>
                  <div className="flex flex-col min-h-screen">
                    <Header />
                    <main className="flex-1"><Profile /></main>
                    <Footer />
                  </div>
                </ProtectedRoute>
              } />
              
              {/* Admin routes */}
              <Route path="/admin" element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout />
                </ProtectedRoute>
              }>
                <Route index element={<AdminDashboard />} />
                <Route path="submissions" element={<AdminSubmissions />} />
                <Route path="payments" element={<PaymentsView />} />
                <Route path="session-settings" element={<SessionSettings />} />
                <Route path="content" element={<ContentManagement />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="ai-assistant" element={<AIAssistant />} />
                <Route path="sessions" element={<AdminSessions />} />
                <Route path="contacts" element={<AdminContacts />} />
                <Route path="winners-export" element={<WinnersManagement />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="command-center" element={<CommandCenter />} />
              </Route>
              
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </LanguageProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
