import { Shield, Mail, Lock, Eye, UserCheck, Database } from "lucide-react";
import { motion } from "framer-motion";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const Privacy = () => {
  const sections = [
    {
      icon: Database,
      title: "Information Collected",
      items: [
        { label: "Account Details", desc: "Name, phone number, email address" },
        { label: "Order and Delivery Information", desc: "Shipping addresses, order history" },
        { label: "Communication Records", desc: "Support inquiries and correspondence" },
        { label: "Technical and Device Information", desc: "Device type, operating system, app version" },
      ]
    },
    {
      icon: Lock,
      title: "Payment Information",
      content: "Payments are processed by licensed third-party payment providers. AfriShop does not store full card numbers, CVV codes, or mobile money PINs. Payment processing is handled securely by our payment partners in compliance with applicable regulations."
    },
    {
      icon: Eye,
      title: "Use of Data",
      items: [
        { desc: "Processing and fulfilling orders" },
        { desc: "Providing customer support" },
        { desc: "Meeting legal and regulatory obligations" },
        { desc: "Improving service reliability" },
      ]
    },
    {
      icon: UserCheck,
      title: "Data Sharing",
      items: [
        { label: "Payment Processors", desc: "To process transactions securely" },
        { label: "Shipping and Logistics Partners", desc: "To coordinate delivery" },
        { label: "Regulatory Authorities", desc: "Where required by law" },
      ],
      footer: "We do not sell personal information to third parties."
    },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 via-black to-emerald-900/20" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center mx-auto mb-8 border border-green-500/20">
              <Shield className="h-10 w-10 text-green-400" />
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Privacy <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">Notice</span>
            </h1>
            <p className="text-white/60">
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Introduction */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <div className="bg-gradient-to-br from-white/5 to-transparent backdrop-blur-xl rounded-3xl p-8 border border-white/10">
              <h2 className="text-2xl font-bold mb-4">Introduction</h2>
              <p className="text-white/70 leading-relaxed">
                This Privacy Notice explains how AfriShop collects, uses, and protects personal information. 
                We are committed to safeguarding your privacy and ensuring transparency in our data practices.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Sections */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto space-y-8">
            {sections.map((section, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="bg-gradient-to-br from-white/5 to-transparent rounded-3xl p-8 border border-white/10"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                    <section.icon className="h-6 w-6 text-green-400" />
                  </div>
                  <h2 className="text-xl font-bold">{section.title}</h2>
                </div>
                
                {section.content && (
                  <p className="text-white/70 leading-relaxed">{section.content}</p>
                )}
                
                {section.items && (
                  <ul className="space-y-3">
                    {section.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 mt-2.5 flex-shrink-0" />
                        <span className="text-white/70">
                          {item.label && <strong className="text-white/90">{item.label}: </strong>}
                          {item.desc}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                
                {section.footer && (
                  <p className="text-white/70 mt-4 pt-4 border-t border-white/10">{section.footer}</p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* User Rights */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/5 rounded-3xl p-8 border border-green-500/20">
              <h2 className="text-xl font-bold mb-4">User Rights</h2>
              <p className="text-white/70 leading-relaxed mb-6">
                Users may request access, correction, or deletion of their personal data. To exercise 
                these rights, please contact us using the information provided below.
              </p>
              <div className="flex items-center gap-4 p-4 bg-black/30 rounded-2xl">
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-white/50">Email</p>
                  <a href="mailto:privacy@afrishop-usa.com" className="text-white hover:text-green-400 transition-colors">
                    privacy@afrishop-usa.com
                  </a>
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

export default Privacy;
