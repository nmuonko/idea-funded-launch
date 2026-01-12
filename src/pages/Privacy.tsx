import { Link } from "react-router-dom";
import { Download, Shield, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-foreground">
            AfriShop
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              How It Works
            </Link>
            <Link to="/privacy" className="text-sm font-medium text-primary">
              Privacy
            </Link>
            <Link to="/download" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Download App
            </Link>
          </nav>
          <Link to="/download">
            <Button size="sm">
              <Download className="h-4 w-4 mr-2" />
              Get the App
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 md:py-20 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto px-4 text-center">
          <Shield className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl md:text-5xl font-bold text-foreground mb-4">
            Privacy Notice
          </h1>
          <p className="text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert">
            
            {/* Introduction */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                This Privacy Notice explains how AfriShop collects, uses, and protects user information. 
                We are committed to safeguarding your privacy and ensuring transparency in our data practices.
              </p>
            </div>

            {/* Information Collected */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">2. Information Collected</h2>
              <p className="text-muted-foreground mb-4">
                We may collect the following types of information when you use our services:
              </p>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Account Information:</strong> Name, email address, phone number</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Order and Transaction Information:</strong> Products ordered, order history, transaction details</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Delivery and Logistics Details:</strong> Shipping addresses, delivery preferences</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Technical Data:</strong> Device type, operating system, app version, usage analytics</span>
                </li>
              </ul>
            </div>

            {/* Payment Information */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">3. Payment Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                Payments are processed by licensed third-party payment providers. AfriShop does not store 
                full card numbers or mobile money credentials. Payment processing is handled securely by 
                our payment partners in compliance with applicable financial regulations.
              </p>
            </div>

            {/* Data Usage */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">4. Data Usage</h2>
              <p className="text-muted-foreground mb-4">
                Your data is used for the following purposes:
              </p>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Processing and fulfilling your orders</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Providing customer support and responding to inquiries</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Improving service quality and user experience</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Meeting legal and regulatory obligations</span>
                </li>
              </ul>
            </div>

            {/* Data Sharing */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">5. Data Sharing</h2>
              <p className="text-muted-foreground mb-4">
                Your data may be shared only with:
              </p>
              <ul className="space-y-2 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Payment Processors:</strong> To securely process your transactions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Shipping and Logistics Partners:</strong> To deliver your orders</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span><strong>Regulatory Authorities:</strong> When required by law</span>
                </li>
              </ul>
              <p className="text-muted-foreground mt-4">
                We do not sell your personal information to third parties.
              </p>
            </div>

            {/* Data Security */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">6. Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                AfriShop applies industry-standard security measures to protect user data. This includes 
                encryption of data in transit and at rest, secure access controls, and regular security 
                assessments. While we strive to protect your information, no method of transmission over 
                the internet is completely secure.
              </p>
            </div>

            {/* User Rights */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-foreground mb-4">7. User Rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                You have the right to:
              </p>
              <ul className="space-y-2 text-muted-foreground mt-4">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Request access to your personal data</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Request correction of inaccurate data</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Request deletion of your personal data</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  <span>Withdraw consent where applicable</span>
                </li>
              </ul>
              <p className="text-muted-foreground mt-4">
                To exercise these rights, please contact us using the information below.
              </p>
            </div>

            {/* Contact Information */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-foreground mb-4">8. Contact Information</h2>
              <p className="text-muted-foreground mb-6">
                If you have questions about this Privacy Notice or wish to exercise your rights, 
                please contact us:
              </p>
              <div className="bg-muted/30 rounded-xl p-6 border border-border/50">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Email</p>
                      <a href="mailto:support@afrishop-usa.com" className="text-foreground hover:text-primary transition-colors">
                        support@afrishop-usa.com
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">WhatsApp</p>
                      <span className="text-foreground">Available in the AfriShop app</span>
                    </div>
                  </div>
                </div>
              </div>
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
            <nav className="flex items-center gap-6">
              <Link to="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                How It Works
              </Link>
              <Link to="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link to="/download" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Download
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Privacy;
