import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, Package, DollarSign, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Index() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(215,30%,18%)]">
        <div className="container relative z-10 px-4 py-20">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-5xl md:text-7xl font-bold text-white animate-fade-in">
              AfriShop USA → DRC
            </h1>
            <p className="text-xl md:text-2xl text-white/90">
              Shop from top US retailers and ship directly to the DRC. Easy. Fast. Reliable.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" variant="secondary">
                <Link to="/auth">Get Started</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="bg-background/10 border-white/20 text-white hover:bg-background/20">
                <Link to="/auth?mode=admin">Admin Login</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl md:text-4xl font-bold">How It Works</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Shop your favorite US stores and we'll handle the rest
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 max-w-6xl mx-auto">
            <Card>
              <CardHeader>
                <ShoppingCart className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Browse & Add</CardTitle>
                <CardDescription>
                  Add items from Amazon, Walmart, eBay, and more to your cart
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Package className="h-10 w-10 text-primary mb-2" />
                <CardTitle>We Purchase</CardTitle>
                <CardDescription>
                  We buy and consolidate your items from multiple stores
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <DollarSign className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Secure Payment</CardTitle>
                <CardDescription>
                  Pay securely with MaishaPay in USD or local currency
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <TrendingUp className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Fast Delivery</CardTitle>
                <CardDescription>
                  Track your shipment to Kinshasa, Lubumbashi, or pickup points
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-gradient-to-br from-[hsl(222,47%,11%)] to-[hsl(215,30%,18%)] text-white">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Ready to start shopping?
            </h2>
            <p className="text-lg text-white/80">
              Create your account and start adding items to your cart today.
            </p>
            <Button asChild size="lg" variant="secondary">
              <Link to="/auth">Sign Up Now</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
