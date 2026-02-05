import { Download, Smartphone, Truck, CreditCard, Bell, HeadphonesIcon, Globe, ArrowRight, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
 import { PublicHeader } from "@/components/public/PublicLayout";
 import { ShopFooter } from "@/components/shop/ShopFooter";

const DownloadPage = () => {
  const features = [
    { icon: CreditCard, title: "Secure In-App Payments", description: "Pay safely using licensed payment providers" },
    { icon: Truck, title: "Order Tracking", description: "Monitor your order from purchase to delivery" },
    { icon: HeadphonesIcon, title: "Customer Support", description: "Access support directly within the app" },
    { icon: Bell, title: "Delivery Updates", description: "Receive notifications on order status changes" },
    { icon: Shield, title: "Identity Verification", description: "Secure account verification for your protection" },
    { icon: Globe, title: "International Access", description: "Shop from retailers that may not ship directly" }
  ];

  const steps = [
    { num: "1", title: "Download the App", desc: "Get AfriShop from Google Play or the App Store" },
    { num: "2", title: "Create an Account", desc: "Sign up with your phone number or email" },
    { num: "3", title: "Add Products", desc: "Browse or paste product links from U.S. stores" },
    { num: "4", title: "Confirm and Pay", desc: "Review costs and complete payment securely in the app" }
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-black to-cyan-900/30" />
        <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-[400px] h-[400px] bg-cyan-500/20 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10">
          <motion.div 
            className="max-w-4xl mx-auto text-center"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="w-28 h-28 rounded-[2rem] bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mx-auto mb-10 border border-white/10"
            >
              <Smartphone className="h-14 w-14 text-cyan-400" />
            </motion.div>
            
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6">
              <span className="bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                Download the
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                AfriShop App
              </span>
            </h1>
            
            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-12">
              AfriShop operates through its mobile app to ensure secure payments, identity verification, 
              order tracking, and customer support.
            </p>
            
            {/* Download Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="https://play.google.com/store/apps/details?id=com.afrishop.usadrc&pcampaignid=web_share" target="_blank" rel="noopener noreferrer">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-4 px-8 py-4 bg-white text-black rounded-2xl font-medium"
                >
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
                    <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.5,12.92 20.16,13.19L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z" />
                  </svg>
                  <div className="text-left">
                    <div className="text-xs opacity-70">Get it on</div>
                    <div className="text-lg font-bold">Google Play</div>
                  </div>
                </motion.div>
              </a>
              
              <a href="https://apps.apple.com" target="_blank" rel="noopener noreferrer">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-4 px-8 py-4 bg-white/10 border border-white/20 text-white rounded-2xl font-medium"
                >
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
                    <path d="M18.71,19.5C17.88,20.74 17,21.95 15.66,21.97C14.32,22 13.89,21.18 12.37,21.18C10.84,21.18 10.37,21.95 9.1,22C7.79,22.05 6.8,20.68 5.96,19.47C4.25,17 2.94,12.45 4.7,9.39C5.57,7.87 7.13,6.91 8.82,6.88C10.1,6.86 11.32,7.75 12.11,7.75C12.89,7.75 14.37,6.68 15.92,6.84C16.57,6.87 18.39,7.1 19.56,8.82C19.47,8.88 17.39,10.1 17.41,12.63C17.44,15.65 20.06,16.66 20.09,16.67C20.06,16.74 19.67,18.11 18.71,19.5M13,3.5C13.73,2.67 14.94,2.04 15.94,2C16.07,3.17 15.6,4.35 14.9,5.19C14.21,6.04 13.07,6.7 11.95,6.61C11.8,5.46 12.36,4.26 13,3.5Z" />
                  </svg>
                  <div className="text-left">
                    <div className="text-xs opacity-70">Download on the</div>
                    <div className="text-lg font-bold">App Store</div>
                  </div>
                </motion.div>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Why App */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div 
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Why the <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">App Is Required</span>
            </h2>
            <p className="text-white/60 text-lg mb-8">
              The AfriShop mobile app provides a secure, reliable experience with payment processing, 
              identity verification, real-time order tracking, and direct access to customer support.
            </p>
            <div className="p-6 bg-white/5 rounded-2xl border border-white/10">
              <p className="text-white/50 text-sm">
                <strong className="text-white/70">Note:</strong> This website is for informational purposes only. 
                All orders, payments, and account management occur exclusively within the AfriShop mobile application.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-900/10 to-transparent" />
        <div className="container mx-auto px-4 relative z-10">
          <motion.h2 
            className="text-3xl md:text-4xl font-bold mb-16 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            App <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Features</span>
          </motion.h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group p-8 rounded-3xl bg-gradient-to-br from-white/5 to-transparent border border-white/10 hover:border-cyan-500/30 transition-all duration-300"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <feature.icon className="h-7 w-7 text-cyan-400" />
                </div>
                <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                <p className="text-white/60">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="py-24">
        <div className="container mx-auto px-4">
          <motion.h2 
            className="text-3xl md:text-4xl font-bold mb-16 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            Getting <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Started</span>
          </motion.h2>
          
          <div className="max-w-3xl mx-auto space-y-4">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: i % 2 === 0 ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-start gap-6 p-6 bg-white/5 rounded-2xl border border-white/10"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {step.num}
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{step.title}</h3>
                  <p className="text-white/60">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-black to-cyan-900/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/20 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-6">
              Ready to <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Get Started</span>?
            </h2>
            <p className="text-xl text-white/60 mb-10 max-w-xl mx-auto">
              Download the AfriShop app to begin using our ordering assistance service.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a href="https://play.google.com/store/apps/details?id=com.afrishop.usadrc&pcampaignid=web_share" target="_blank" rel="noopener noreferrer">
                <Button size="lg" className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white border-0 rounded-full px-10 h-16 text-lg">
                  <Download className="h-5 w-5 mr-3" />
                  Download Now
                  <ArrowRight className="h-5 w-5 ml-3" />
                </Button>
              </a>
              <Link to="/">
                <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 rounded-full px-10 h-16 text-lg">
                  Learn More
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

       <ShopFooter />
    </div>
  );
};

export default DownloadPage;
