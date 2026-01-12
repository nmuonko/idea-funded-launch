import { FileText, AlertTriangle, Scale, Ban, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";

const Terms = () => {
  const userResponsibilities = [
    "Providing accurate order and delivery information",
    "Ensuring purchased items comply with destination country laws and regulations",
    "Reviewing order details before confirmation",
    "Maintaining accurate account information",
    "Complying with applicable laws when using the service"
  ];

  const prohibitedItems = [
    "Items prohibited by origin or destination country laws",
    "Hazardous materials or dangerous goods",
    "Counterfeit or infringing products",
    "Items restricted by shipping carriers"
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-black to-violet-900/20" />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center mx-auto mb-8 border border-purple-500/20">
              <FileText className="h-10 w-10 text-purple-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Terms of <span className="bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">Service</span>
            </h1>
            <p className="text-white/60">
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Service Nature */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-violet-500/20 flex items-center justify-center">
                  <Scale className="h-6 w-6 text-purple-400" />
                </div>
                <h2 className="text-xl font-bold">Service Nature</h2>
              </div>
              <p className="text-white/70 leading-relaxed mb-4">
                AfriShop provides an ordering assistance and logistics facilitation service. We help users 
                purchase products from international retailers and coordinate delivery to their location.
              </p>
              <div className="p-4 bg-purple-500/10 rounded-2xl border border-purple-500/20">
                <p className="text-white/80 text-sm">
                  <strong>Important:</strong> AfriShop is not the seller of third-party goods. Products are 
                  purchased from independent retailers and AfriShop acts as a facilitation service.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* User Responsibilities */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <h2 className="text-xl font-bold mb-6">User Responsibilities</h2>
              <p className="text-white/70 mb-6">Users are responsible for:</p>
              <ul className="space-y-3">
                {userResponsibilities.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-2.5 flex-shrink-0" />
                    <span className="text-white/70">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Service Limitations */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 rounded-3xl p-8 border border-amber-500/20">
              <div className="flex items-start gap-4 mb-4">
                <AlertTriangle className="h-6 w-6 text-amber-400 flex-shrink-0 mt-1" />
                <h2 className="text-xl font-bold">Service Limitations</h2>
              </div>
              <div className="space-y-4 text-white/70">
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
          </motion.div>
        </div>
      </section>

      {/* Prohibited Items */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500/20 to-rose-500/20 flex items-center justify-center">
                  <Ban className="h-6 w-6 text-red-400" />
                </div>
                <h2 className="text-xl font-bold">Prohibited Items</h2>
              </div>
              <p className="text-white/70 mb-6">Users may not use AfriShop to purchase or ship:</p>
              <ul className="space-y-3">
                {prohibitedItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-2.5 flex-shrink-0" />
                    <span className="text-white/70">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Liability & Modifications */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10"
            >
              <h2 className="text-lg font-bold mb-4">Limitation of Liability</h2>
              <p className="text-white/70 text-sm leading-relaxed">
                To the extent permitted by applicable law, AfriShop's liability is limited to the 
                service fees paid for the specific order in question.
              </p>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10"
            >
              <div className="flex items-center gap-3 mb-4">
                <RefreshCw className="h-5 w-5 text-purple-400" />
                <h2 className="text-lg font-bold">Modifications</h2>
              </div>
              <p className="text-white/70 text-sm leading-relaxed">
                AfriShop reserves the right to modify these Terms of Service. Users will be notified 
                of material changes.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};

export default Terms;
