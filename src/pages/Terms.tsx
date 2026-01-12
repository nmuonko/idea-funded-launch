import { Link } from "react-router-dom";
import { Download, FileText, AlertTriangle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-foreground">
            AfriShop
          </Link>
          <nav className="hidden md:flex items-center gap-4 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="font-medium text-primary">Terms</Link>
            <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
            <Link to="/refunds" className="text-muted-foreground hover:text-foreground transition-colors">Refunds</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/download" className="hidden sm:inline-flex">
              <Button size="sm">
                <Download className="h-4 w-4 mr-2" />
                Get App
              </Button>
            </Link>
            <Link to="/auth?mode=admin">
              <Button size="sm" variant="ghost">
                <LogIn className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-20 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <FileText className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            Terms of Service
          </h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            
            {/* Service Nature */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Service Nature</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                AfriShop provides an ordering assistance and logistics facilitation service. We help users 
                purchase products from international retailers and coordinate delivery to their location.
              </p>
              <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                <p className="text-muted-foreground text-sm">
                  <strong>Important:</strong> AfriShop is not the seller of third-party goods. Products are 
                  purchased from independent retailers and AfriShop acts as a facilitation service.
                </p>
              </div>
            </div>

            {/* User Responsibilities */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">User Responsibilities</h2>
              <p className="text-muted-foreground mb-4">
                Users are responsible for:
              </p>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Providing accurate order and delivery information</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Ensuring purchased items comply with destination country laws and regulations</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Reviewing order details before confirmation</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Maintaining accurate account information</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Complying with applicable laws when using the service</span>
                </li>
              </ul>
            </div>

            {/* Service Limitations */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Service Limitations</h2>
              <div className="bg-muted/30 rounded-xl p-6 border border-border/50">
                <div className="flex items-start gap-4">
                  <AlertTriangle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-1" />
                  <div className="space-y-3 text-muted-foreground">
                    <p>
                      Delivery times, customs delays, and product availability may vary based on factors 
                      beyond AfriShop's control.
                    </p>
                    <p>
                      AfriShop does not guarantee retailer stock availability, pricing accuracy at time 
                      of purchase, or specific delivery timeframes.
                    </p>
                    <p>
                      Customs duties, taxes, and import fees are determined by destination country 
                      authorities and may vary.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Prohibited Items */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Prohibited Items</h2>
              <p className="text-muted-foreground mb-4">
                Users may not use AfriShop to purchase or ship:
              </p>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Items prohibited by origin or destination country laws</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Hazardous materials or dangerous goods</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Counterfeit or infringing products</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="text-primary mt-1">•</span>
                  <span>Items restricted by shipping carriers</span>
                </li>
              </ul>
            </div>

            {/* Limitation of Liability */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                To the extent permitted by applicable law, AfriShop's liability is limited to the 
                service fees paid for the specific order in question.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                AfriShop is not liable for retailer actions, product defects, customs decisions, 
                carrier delays, or other factors outside our reasonable control.
              </p>
            </div>

            {/* Modifications */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">Modifications</h2>
              <p className="text-muted-foreground leading-relaxed">
                AfriShop reserves the right to modify these Terms of Service. Users will be notified 
                of material changes through the app or email. Continued use of the service after 
                changes constitutes acceptance of the updated terms.
              </p>
            </div>

            {/* Governing Law */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-foreground mb-4">Governing Law</h2>
              <p className="text-muted-foreground leading-relaxed">
                These terms are governed by applicable laws in the jurisdictions where AfriShop operates. 
                Any disputes shall be resolved through the appropriate legal channels.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border/40 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} AfriShop. All rights reserved.
            </p>
            <nav className="flex flex-wrap items-center justify-center gap-4 md:gap-6 text-sm">
              <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
              <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
              <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
              <Link to="/payments-compliance" className="text-muted-foreground hover:text-foreground transition-colors">Payments</Link>
              <Link to="/refunds" className="text-muted-foreground hover:text-foreground transition-colors">Refunds</Link>
              <Link to="/download" className="text-muted-foreground hover:text-foreground transition-colors">Download</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Terms;
