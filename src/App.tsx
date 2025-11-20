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
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import Apply from "./pages/Apply";
import Results from "./pages/Results";
import Terms from "./pages/Terms";
import Contact from "./pages/Contact";
import Auth from "./pages/Auth";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminSessions from "./pages/admin/Sessions";
import AdminSubmissions from "./pages/admin/Submissions";
import AdminContacts from "./pages/admin/Contacts";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
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
              <Route path="/terms" element={
                <div className="flex flex-col min-h-screen">
                  <Header />
                  <main className="flex-1"><Terms /></main>
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
              
              {/* Admin routes */}
              <Route path="/admin" element={
                <ProtectedRoute requireAdmin>
                  <AdminLayout />
                </ProtectedRoute>
              }>
                <Route index element={<AdminDashboard />} />
                <Route path="sessions" element={<AdminSessions />} />
                <Route path="submissions" element={<AdminSubmissions />} />
                <Route path="contacts" element={<AdminContacts />} />
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
