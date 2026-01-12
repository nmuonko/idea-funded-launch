import { useEffect, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Globe, CheckCircle, Clock, ArrowRight } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

// ISO 3166-1 alpha-3 to numeric mapping for Africa
const countryCodeMap: Record<string, string> = {
  COD: "180", // Democratic Republic of the Congo
  COG: "178", // Republic of the Congo
  AGO: "024", // Angola
  ZMB: "894", // Zambia
  TZA: "834", // Tanzania
  KEN: "404", // Kenya
  UGA: "800", // Uganda
  RWA: "646", // Rwanda
  BDI: "108", // Burundi
  CAF: "140", // Central African Republic
  SSD: "728", // South Sudan
  SDN: "729", // Sudan
  NGA: "566", // Nigeria
  GHA: "288", // Ghana
  ZAF: "710", // South Africa
  ETH: "231", // Ethiopia
  EGY: "818", // Egypt
  MAR: "504", // Morocco
  TUN: "788", // Tunisia
  DZA: "012", // Algeria
  CMR: "120", // Cameroon
  CIV: "384", // Côte d'Ivoire
  SEN: "686", // Senegal
  MLI: "466", // Mali
  BFA: "854", // Burkina Faso
};

// Upcoming countries (not yet in database but planned)
const upcomingCountries = [
  { name: "Rwanda", code: "RWA" },
  { name: "Uganda", code: "UGA" },
  { name: "Kenya", code: "KEN" },
  { name: "Tanzania", code: "TZA" },
];

export default function Coverage() {
  const [countries, setCountries] = useState<SupportedCountry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCountries() {
      const { data, error } = await supabase
        .from("supported_countries")
        .select("*")
        .eq("is_active", true);

      if (!error && data) {
        setCountries(data);
      }
      setLoading(false);
    }

    fetchCountries();
  }, []);

  const supportedCountryCodes = countries.map((c) => countryCodeMap[c.country_code]).filter(Boolean);
  const upcomingCodes = upcomingCountries
    .filter(u => !countries.some(c => c.country_code === u.code))
    .map(u => countryCodeMap[u.code])
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/20 via-black to-slate-900/20" />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />

        <div className="container mx-auto px-4 relative z-10">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6"
            >
              <Globe className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 text-sm font-medium">Expanding Across Africa</span>
            </motion.div>

            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Our <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Coverage</span>
            </h1>
            <p className="text-lg text-white/60 max-w-2xl mx-auto">
              We're bringing international shopping to Africa, one country at a time. See where AfriShop delivers today and where we're heading next.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Map Section */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative rounded-3xl overflow-hidden bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 p-6"
          >
            {/* Glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-cyan-500/5 pointer-events-none" />

            {loading ? (
              <div className="flex items-center justify-center h-[500px]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
              </div>
            ) : (
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{
                  center: [20, 0],
                  scale: 350,
                }}
                style={{ width: "100%", height: "auto", minHeight: "500px" }}
              >
                <ZoomableGroup center={[20, 0]} zoom={1}>
                  <Geographies geography={geoUrl}>
                    {({ geographies }) =>
                      geographies.map((geo) => {
                        const isSupported = supportedCountryCodes.includes(geo.id);
                        const isUpcoming = upcomingCodes.includes(geo.id);
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            fill={isSupported ? "#10b981" : isUpcoming ? "#f59e0b" : "#334155"}
                            stroke="#1e293b"
                            strokeWidth={0.5}
                            style={{
                              default: {
                                outline: "none",
                                transition: "all 0.3s ease",
                              },
                              hover: {
                                fill: isSupported ? "#34d399" : isUpcoming ? "#fbbf24" : "#475569",
                                outline: "none",
                                cursor: "pointer",
                              },
                              pressed: { outline: "none" },
                            }}
                          />
                        );
                      })
                    }
                  </Geographies>

                  {/* Markers for active countries */}
                  {countries.map((country) => (
                    <Marker
                      key={country.id}
                      coordinates={[country.longitude, country.latitude]}
                    >
                      <motion.g
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.5, type: "spring" }}
                      >
                        <circle r={8} fill="#10b981" stroke="#ffffff" strokeWidth={2} />
                        <circle r={16} fill="#10b981" opacity={0.3} className="animate-ping" />
                      </motion.g>
                    </Marker>
                  ))}
                </ZoomableGroup>
              </ComposableMap>
            )}

            {/* Legend */}
            <div className="absolute bottom-6 left-6 flex flex-col gap-3 bg-slate-900/80 backdrop-blur-sm rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center gap-3 text-sm text-white">
                <div className="w-4 h-4 rounded bg-emerald-500" />
                <span>Active Service Zone</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-amber-400">
                <div className="w-4 h-4 rounded bg-amber-500" />
                <span>Coming Soon</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-400">
                <div className="w-4 h-4 rounded bg-slate-600" />
                <span>Future Expansion</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Active Countries Grid */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Currently <span className="text-emerald-400">Serving</span>
            </h2>
            <p className="text-white/60 max-w-xl mx-auto">
              We're live in these countries with full delivery and support services.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {countries.length > 0 ? (
              countries.map((country, index) => (
                <motion.div
                  key={country.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-4 p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 hover:border-emerald-500/40 transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{country.country_name}</h3>
                    <p className="text-sm text-emerald-400">Active</p>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-white/40">
                Loading active regions...
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Coming Soon Section */}
      <section className="py-20 px-4 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-amber-900/5 to-transparent" />
        <div className="max-w-6xl mx-auto relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="text-amber-400">Coming</span> Soon
            </h2>
            <p className="text-white/60 max-w-xl mx-auto">
              We're actively working to expand to these countries. Stay tuned!
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {upcomingCountries
              .filter(u => !countries.some(c => c.country_code === u.code))
              .map((country, index) => (
                <motion.div
                  key={country.code}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-4 p-5 rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20"
                >
                  <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">{country.name}</h3>
                    <p className="text-xs text-amber-400/70">Coming soon</p>
                  </div>
                </motion.div>
              ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/30 via-black to-cyan-900/30" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/20 rounded-full blur-3xl" />

        <div className="container mx-auto px-4 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <MapPin className="h-16 w-16 text-emerald-400 mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              In Your <span className="text-emerald-400">Region</span>?
            </h2>
            <p className="text-lg text-white/60 mb-8 max-w-md mx-auto">
              Download the AfriShop app and start shopping from U.S. stores today.
            </p>
            <Link to="/download">
              <Button size="lg" className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white border-0 rounded-full px-8 h-14 text-lg">
                Get the App
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
