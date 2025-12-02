import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Lock, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import afrishopLogo from '@/assets/afrishop-logo.png';

export default function Index() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)]">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center relative z-10 px-4 py-12">
        <div className="w-full max-w-md space-y-8">
          {/* Logo */}
          <div className="flex justify-center animate-fade-in">
            <img 
              src={afrishopLogo} 
              alt="AfriShop - From USA to You" 
              className="h-16 md:h-20 w-auto"
            />
          </div>

          {/* Login Card */}
          <Card className="bg-card/50 backdrop-blur-xl border-border/30 shadow-2xl animate-scale-in">
            <CardHeader className="text-center space-y-2 pb-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">Admin Portal</CardTitle>
              <CardDescription className="text-muted-foreground">
                Authorized personnel only. Enter your credentials to access the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Button asChild size="lg" className="w-full h-12 text-base font-medium">
                <Link to="/auth?mode=admin">
                  <Lock className="mr-2 h-4 w-4" />
                  Sign In to Dashboard
                </Link>
              </Button>
              
              <div className="pt-4 border-t border-border/30">
                <p className="text-xs text-center text-muted-foreground">
                  Access is restricted to authorized administrators.
                  <br />
                  Contact your system administrator for credentials.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/30 border border-border/20 text-xs text-muted-foreground">
              <Zap className="h-3 w-3 text-primary" />
              Real-time Analytics
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/30 border border-border/20 text-xs text-muted-foreground">
              <Shield className="h-3 w-3 text-primary" />
              Secure Access
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/30 border border-border/20 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 text-primary" />
              Role-Based Control
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center">
        <p className="text-xs text-muted-foreground/60">
          © {new Date().getFullYear()} AfriShop. Admin Backend v1.0
        </p>
      </footer>
    </div>
  );
}
