import { Building2, Globe, Truck, Shield, Mail, MapPin, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";
import afrishopLogo from "@/assets/afrishop-logo.png";

const About = () => {
  const services = [
    {
      icon: Globe,
      title: "Cross-Border E-Commerce",
      desc: "Access to U.S. retailers and products not available locally"
    },
    {
      icon: Truck,
      title: "International Logistics",
      desc: "Shipping, customs clearance, and delivery to your doorstep"
    },
    {
      icon: Shield,
      title: "Secure Payments",
      desc: "Multiple payment options including mobile money and bank transfers"
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-900/20 via-black to-purple-900/20" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-24 h-24 rounded-3xl bg-white/10 flex items-center justify-center mx-auto mb-8 border border-white/20 p-4">
              <img src={afrishopLogo} alt="AfriShop" className="w-full h-full object-contain" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              About <span className="bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-transparent">AfriShop</span>
            </h1>
            <p className="text-lg text-white/60">
              Bridging the gap between U.S. retailers and African consumers.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Brand Statement */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-violet-500/10 to-purple-500/5 rounded-3xl p-8 border border-violet-500/20">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-violet-400" />
                </div>
                <h2 className="text-xl font-bold">Our Company</h2>
              </div>
              <div className="space-y-4 text-white/70 leading-relaxed">
                <p className="text-lg">
                  <strong className="text-white">AfriShop</strong> is a brand and trade name operated by{" "}
                  <strong className="text-white">AMERICAN GOODWILL SARL</strong>, a company registered in the 
                  Democratic Republic of the Congo.
                </p>
                <p>
                  We specialize in cross-border e-commerce and logistics, helping customers in Africa 
                  purchase products from U.S. retailers and have them delivered directly to their location.
                </p>
                <p>
                  Our platform simplifies international shopping by handling procurement, payment processing, 
                  international shipping, customs clearance, and last-mile delivery—all in one seamless experience.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* What We Do */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.h2 
            className="text-2xl font-bold mb-10 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            What We Do
          </motion.h2>
          
          <div className="max-w-4xl mx-auto grid md:grid-cols-3 gap-6">
            {services.map((service, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-6 border border-white/10 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
                  <service.icon className="h-7 w-7 text-violet-400" />
                </div>
                <h3 className="font-semibold mb-2">{service.title}</h3>
                <p className="text-white/60 text-sm">{service.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Company Details */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <h2 className="text-xl font-bold mb-6">Company Details</h2>
              
              <div className="space-y-6">
                <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl">
                  <Building2 className="h-5 w-5 text-violet-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-white/50 mb-1">Legal Entity</p>
                    <p className="font-semibold">AMERICAN GOODWILL SARL</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl">
                  <FileText className="h-5 w-5 text-violet-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-white/50 mb-1">Registration (RCCM)</p>
                    <p className="font-semibold">CD/LSH/RCCM/17-B-6093</p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl">
                  <FileText className="h-5 w-5 text-violet-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-white/50 mb-1">National ID / Tax ID</p>
                    <p className="font-semibold">ID Nat: 05-F4300-N05127D | NIF: A2313322G</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl">
                  <MapPin className="h-5 w-5 text-violet-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-white/50 mb-1">Registered Address</p>
                    <p className="font-semibold">
                      114 Croisement des Avenues Ndjamena et Kasaï<br />
                      Quartier Makutano, Commune de Lubumbashi<br />
                      Haut-Katanga, République Démocratique du Congo
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl">
                  <Mail className="h-5 w-5 text-violet-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-white/50 mb-1">Contact</p>
                    <a href="mailto:support@afrishop-usa.com" className="font-semibold text-violet-400 hover:underline">
                      support@afrishop-usa.com
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};

export default About;
