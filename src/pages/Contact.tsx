import { Mail, MessageCircle, MapPin, Phone, Building2, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { SEOHead } from '@/components/SEOHead';
 import { PublicHeader } from "@/components/public/PublicLayout";
 import { ShopFooter } from "@/components/shop/ShopFooter";

const Contact = () => {
  const contactMethods = [
    {
      icon: Mail,
      title: "Email Support",
      desc: "For general inquiries and order support",
      value: "support@afrishop-usa.com",
      href: "mailto:support@afrishop-usa.com",
      color: "blue"
    },
    {
      icon: MessageCircle,
      title: "WhatsApp",
      desc: "Quick responses during business hours",
      value: "+243 97 280 9832",
      href: "https://wa.me/243972809832",
      color: "green"
    },
    {
      icon: Phone,
      title: "Phone",
      desc: "Direct line for urgent matters",
      value: "+243 97 280 9832",
      href: "tel:+243972809832",
      color: "violet"
    },
  ];

  return (
    <SEOHead title="Contact AfriShop Support" description="Reach AfriShop via WhatsApp, email or phone for orders, deliveries and customer support in DR Congo." />
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-black to-blue-900/20" />
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mx-auto mb-8 border border-cyan-500/20">
              <Mail className="h-10 w-10 text-cyan-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Contact <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Us</span>
            </h1>
            <p className="text-lg text-white/60">
              We're here to help. Reach out through any of the channels below.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Methods */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto grid md:grid-cols-3 gap-6">
            {contactMethods.map((method, i) => (
              <motion.a
                key={i}
                href={method.href}
                target={method.href.startsWith("http") ? "_blank" : undefined}
                rel={method.href.startsWith("http") ? "noopener noreferrer" : undefined}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="group bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-6 border border-white/10 text-center hover:border-white/20 transition-all"
              >
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${
                  method.color === 'blue' ? 'from-blue-500/20 to-cyan-500/20' :
                  method.color === 'green' ? 'from-green-500/20 to-emerald-500/20' :
                  'from-violet-500/20 to-purple-500/20'
                } flex items-center justify-center mx-auto mb-4`}>
                  <method.icon className={`h-7 w-7 ${
                    method.color === 'blue' ? 'text-blue-400' :
                    method.color === 'green' ? 'text-green-400' :
                    'text-violet-400'
                  }`} />
                </div>
                <h3 className="font-semibold mb-1">{method.title}</h3>
                <p className="text-white/50 text-sm mb-3">{method.desc}</p>
                <p className={`font-medium ${
                  method.color === 'blue' ? 'text-blue-400 group-hover:text-blue-300' :
                  method.color === 'green' ? 'text-green-400 group-hover:text-green-300' :
                  'text-violet-400 group-hover:text-violet-300'
                } transition-colors`}>
                  {method.value}
                </p>
              </motion.a>
            ))}
          </div>
        </div>
      </section>

      {/* Business Hours & Address */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-amber-400" />
                </div>
                <h2 className="text-xl font-bold">Business Hours</h2>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-white/10">
                  <span className="text-white/70">Monday - Friday</span>
                  <span className="font-medium">8:00 AM - 6:00 PM (CAT)</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-white/10">
                  <span className="text-white/70">Saturday</span>
                  <span className="font-medium">9:00 AM - 2:00 PM (CAT)</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-white/70">Sunday</span>
                  <span className="text-white/50">Closed</span>
                </div>
              </div>
              <p className="text-white/50 text-sm mt-4">
                Response times may vary during weekends and holidays.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                  <MapPin className="h-6 w-6 text-cyan-400" />
                </div>
                <h2 className="text-xl font-bold">Office Address</h2>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-white/5 rounded-2xl">
                  <div className="flex items-start gap-3">
                    <Building2 className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold mb-1">AMERICAN GOODWILL SARL</p>
                      <p className="text-white/60 text-sm mb-2">
                        114 Croisement des Avenues Ndjamena et Kasaï<br />
                        Quartier Makutano, Commune de Lubumbashi<br />
                        Haut-Katanga, République Démocratique du Congo
                      </p>
                      <p className="text-white/50 text-xs">
                        RCCM: CD/LSH/RCCM/17-B-6093 | ID Nat: 05-F4300-N05127D
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-white/50 text-sm">
                  Note: This is our registered business address. For order support, 
                  please use email or WhatsApp for faster response.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Support Notice */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/5 rounded-3xl p-8 border border-cyan-500/20 text-center">
              <h3 className="text-xl font-bold mb-4">Need Help With an Order?</h3>
              <p className="text-white/70 mb-6">
                For the fastest support, please have your order reference number ready when contacting us. 
                You can find this in your order confirmation email or in the AfriShop app.
              </p>
              <a
                href="mailto:support@afrishop-usa.com"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-medium rounded-full transition-all"
              >
                <Mail className="h-5 w-5" />
                Email Support Team
              </a>
            </div>
          </motion.div>
        </div>
      </section>

       <ShopFooter />
    </div>
  );
};

export default Contact;
