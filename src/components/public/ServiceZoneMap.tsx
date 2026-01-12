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
import { MapPin } from "lucide-react";

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

// ISO 3166-1 alpha-3 to alpha-2 mapping for common African countries
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
};

export function ServiceZoneMap() {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
      className="py-20 px-4"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6"
          >
            <MapPin className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-400 text-sm font-medium">Service Coverage</span>
          </motion.div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Where We Deliver
          </h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            We're expanding across Africa. See the regions we currently serve with our international shopping service.
          </p>
        </div>

        <div className="relative rounded-2xl overflow-hidden bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 p-4">
          {/* Glow effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
          
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{
              center: [20, -5],
              scale: 400,
            }}
            style={{ width: "100%", height: "auto" }}
          >
            <ZoomableGroup center={[20, -5]} zoom={1}>
              <Geographies geography={geoUrl}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const isSupported = supportedCountryCodes.includes(geo.id);
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={isSupported ? "#10b981" : "#334155"}
                        stroke="#1e293b"
                        strokeWidth={0.5}
                        style={{
                          default: {
                            outline: "none",
                            transition: "all 0.3s ease",
                          },
                          hover: {
                            fill: isSupported ? "#34d399" : "#475569",
                            outline: "none",
                            cursor: "pointer",
                          },
                          pressed: {
                            outline: "none",
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>

              {/* Markers for supported countries */}
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
                    <circle
                      r={8}
                      fill="#10b981"
                      stroke="#ffffff"
                      strokeWidth={2}
                      className="drop-shadow-lg"
                    />
                    <circle
                      r={16}
                      fill="#10b981"
                      opacity={0.3}
                      className="animate-ping"
                    />
                  </motion.g>
                </Marker>
              ))}
            </ZoomableGroup>
          </ComposableMap>

          {/* Legend */}
          <div className="absolute bottom-6 left-6 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <div className="w-4 h-4 rounded bg-emerald-500" />
              <span>Active Service Zone</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <div className="w-4 h-4 rounded bg-slate-600" />
              <span>Coming Soon</span>
            </div>
          </div>

          {/* Country list */}
          {countries.length > 0 && (
            <div className="absolute bottom-6 right-6 bg-slate-800/80 backdrop-blur-sm rounded-lg p-4 border border-slate-700/50">
              <h4 className="text-white font-semibold text-sm mb-2">Currently Serving</h4>
              <ul className="space-y-1">
                {countries.map((country) => (
                  <li key={country.id} className="flex items-center gap-2 text-sm text-slate-300">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    {country.country_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
