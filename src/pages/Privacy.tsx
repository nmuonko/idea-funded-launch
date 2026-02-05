import { Shield, Mail, Lock, Eye, UserCheck, Database, ShieldCheck, Clock, Share2, Building2 } from "lucide-react";
import { motion } from "framer-motion";
 import { PublicHeader } from "@/components/public/PublicLayout";
 import { ShopFooter } from "@/components/shop/ShopFooter";

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
        { label: "Order and Delivery Information", desc: "Shipping addresses, order history, product preferences" },
        { label: "Communication Records", desc: "Customer support inquiries and correspondence" },
        { label: "Technical and Device Information", desc: "Device type, operating system, app version, IP address" },
        { label: "Transaction Data", desc: "Payment method types (not full payment details), order amounts, timestamps" },
      ]
    },
    {
      icon: Lock,
      title: "Payment Information",
      content: "Payments are processed by licensed third-party payment providers. AfriShop does not store full card numbers, CVV codes, or mobile money PINs. All payment processing is handled securely by authorized payment partners in compliance with applicable financial regulations."
    },
    {
      icon: Eye,
      title: "Purpose of Data Collection",
      intro: "Personal information is collected and used to:",
      items: [
        { desc: "Process and fulfill orders placed through the platform" },
        { desc: "Provide customer support and respond to inquiries" },
        { desc: "Verify payments and prevent fraud" },
        { desc: "Communicate order status and delivery updates" },
        { desc: "Meet legal, regulatory, and compliance obligations" },
        { desc: "Improve app performance and service reliability" },
      ]
    },
    {
      icon: Share2,
      title: "Data Sharing with Third Parties",
      intro: "AfriShop may share personal information with:",
      items: [
        { label: "Payment processors", desc: "for secure transaction handling and verification" },
        { label: "Shipping and logistics partners", desc: "to coordinate order delivery and tracking" },
        { label: "Customs and freight forwarders", desc: "for international shipping documentation" },
        { label: "Regulatory authorities", desc: "when required by law or legal process" },
      ],
      footer: "AfriShop does not sell personal information to third parties for marketing purposes."
    },
    {
      icon: ShieldCheck,
      title: "Data Security",
      content: "AfriShop implements appropriate technical and organizational security measures to protect personal information. Data is transmitted securely using encryption and access controls to prevent unauthorized access, alteration, or disclosure. We regularly review our security practices and update them as necessary."
    },
    {
      icon: Clock,
      title: "Data Retention",
      content: "Personal data is retained for as long as necessary to fulfill the purposes outlined in this Privacy Notice, including: active account management, order fulfillment and support, legal and regulatory compliance (typically 5-7 years for financial records), and dispute resolution. You may request deletion of your account and personal data by contacting us."
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
              Privacy <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">Policy</span>
            </h1>
            <p className="text-white/60 text-lg">
              AfriShop — Operated by AMERICAN GOODWILL SARL
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
              <div className="space-y-4 text-white/70 leading-relaxed">
                <p>
                  This Privacy Policy explains how AfriShop (a brand operated by{" "}
                  <strong className="text-white/90">AMERICAN GOODWILL SARL</strong>) collects, uses, 
                  shares, and protects personal information.
                </p>
                <p>
                  We are committed to safeguarding user privacy and ensuring transparency in our data practices. 
                  By using AfriShop, you consent to the data practices described in this policy.
                </p>
              </div>
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

                {section.intro && (
                  <p className="text-white/70 leading-relaxed mb-4">{section.intro}</p>
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
              <h2 className="text-xl font-bold mb-4">Your Rights</h2>
              <p className="text-white/70 leading-relaxed mb-6">
                You have the right to request access to, correction of, or deletion of your personal data. 
                You may also request a copy of your data or ask us to restrict processing in certain circumstances.
              </p>
              <p className="text-white/70 leading-relaxed mb-6">
                To exercise these rights, please contact us using the information below. We will respond to 
                your request within 30 days.
              </p>
              <div className="flex items-center gap-4 p-4 bg-black/30 rounded-2xl">
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-white/50">Privacy Requests</p>
                  <a href="mailto:privacy@afrishop-usa.com" className="text-white hover:text-green-400 transition-colors">
                    privacy@afrishop-usa.com
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Data Controller */}
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
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-green-400" />
                </div>
                <h2 className="text-xl font-bold">Data Controller</h2>
              </div>
              <div className="space-y-2 text-white/70">
                <p><strong className="text-white/90">Company:</strong> AMERICAN GOODWILL SARL</p>
                <p><strong className="text-white/90">RCCM:</strong> CD/LSH/RCCM/17-B-6093</p>
                <p><strong className="text-white/90">ID National:</strong> 05-F4300-N05127D | NIF: A2313322G</p>
                <p><strong className="text-white/90">Address:</strong> 114 Croisement Av. Ndjamena & Kasaï, Q. Makutano, Lubumbashi, Haut-Katanga, RDC</p>
                <p><strong className="text-white/90">Email:</strong>{" "}
                  <a href="mailto:privacy@afrishop-usa.com" className="text-green-400 hover:underline">
                    privacy@afrishop-usa.com
                  </a>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

       <ShopFooter />
    </div>
  );
};

export default Privacy;
