import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from "react-leaflet";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Globe, CheckCircle, Clock, ArrowRight, MapPin } from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/public/PublicLayout";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// Custom green marker for active countries
const activeIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Custom orange marker for upcoming countries
const upcomingIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  latitude: number;
  longitude: number;
  is_active: boolean;
}

// Upcoming countries with coordinates
const upcomingCountries = [
  { name: "Rwanda", code: "RWA", lat: -1.9403, lng: 29.8739 },
  { name: "Uganda", code: "UGA", lat: 1.3733, lng: 32.2903 },
  { name: "Kenya", code: "KEN", lat: -0.0236, lng: 37.9062 },
  { name: "Tanzania", code: "TZA", lat: -6.369, lng: 34.8888 },
];

// Simplified GeoJSON for African countries (boundaries)
const COUNTRY_GEOJSON: Record<string, any> = {
  COD: {
    type: "Feature",
    properties: { name: "Democratic Republic of the Congo" },
    geometry: {
      type: "Polygon",
      coordinates: [[[12.18,-5.79],[12.32,-6.1],[13.02,-5.98],[13.38,-5.85],[16.33,-5.88],[17.01,-5.5],[17.54,-5.26],[18.13,-4.59],[18.35,-3.5],[18.07,-2.9],[18.39,-2.47],[18.62,-1.06],[17.91,-0.74],[17.77,0.57],[17.9,1.74],[18.47,2.36],[18.55,3.48],[18.49,4.33],[19.07,4.89],[19.47,5.03],[20.29,4.69],[20.93,4.32],[21.66,4.22],[22.41,4.03],[23.3,4.61],[24.41,5.11],[25.12,4.93],[25.65,5.26],[26.4,5.15],[27.04,5.17],[27.37,5.23],[27.98,4.41],[28.43,4.29],[28.7,4.45],[29.16,4.39],[29.72,4.6],[29.95,4.17],[30.84,3.51],[30.47,3.02],[30.53,2.43],[30.74,2.41],[31.17,2.2],[29.58,0.59],[29.82,-0.21],[29.59,-0.59],[29.42,-0.96],[29.52,-1.41],[29.29,-1.62],[29.26,-2.22],[29.12,-2.29],[29.02,-2.84],[28.85,-2.94],[28.8,-3.3],[29.02,-4.5],[29.34,-4.5],[29.52,-5.42],[29.42,-5.94],[29,-6.17],[28.59,-6.39],[28.51,-6.71],[28.15,-6.82],[27.62,-7],[27.32,-6.7],[27.23,-6.54],[26.88,-6.01],[26.97,-5.86],[26.76,-5.79],[26.21,-5.76],[25.79,-5.87],[25.26,-5.64],[25.03,-5.29],[24.41,-5.36],[23.91,-5],[22.87,-4.95],[22.7,-4.63],[22.38,-4.42],[21.66,-4.21],[21.14,-3.93],[20.91,-3.9],[20.1,-3.28],[19.99,-3.01],[19.6,-3],[18.48,-2.92],[18.28,-3.35],[17.85,-3.54],[17.7,-3.25],[17.41,-3.54],[16.82,-3.39],[16.57,-3.54],[16.22,-3.3],[16.02,-3.54],[15.9,-3.46],[15.75,-3.86],[15.47,-4.09],[14.74,-4.5],[14.36,-4.36],[14.23,-4.79],[14.41,-4.87],[14.52,-5.28],[14.07,-5.46],[13.91,-5.85],[13.35,-5.85],[12.7,-5.97],[12.18,-5.79]]]
    }
  },
  RWA: {
    type: "Feature",
    properties: { name: "Rwanda" },
    geometry: {
      type: "Polygon",
      coordinates: [[[30.42,-1.13],[30.82,-1.47],[30.76,-2.28],[30.47,-2.41],[30.09,-2.33],[29.58,-2.74],[29.02,-2.84],[29.12,-2.29],[29.26,-2.22],[29.29,-1.62],[29.52,-1.41],[29.88,-1.13],[30.42,-1.13]]]
    }
  },
  UGA: {
    type: "Feature",
    properties: { name: "Uganda" },
    geometry: {
      type: "Polygon",
      coordinates: [[[31.86,3.77],[31.17,3.78],[30.77,2.34],[30.47,2.41],[30.47,3.02],[30.53,3.02],[30.84,3.51],[29.95,4.17],[29.72,4.6],[29.16,4.39],[28.7,4.45],[28.43,4.29],[27.98,4.41],[27.37,5.23],[27.21,5.55],[28.19,5.28],[29.59,4.28],[30.27,3.03],[30.47,2.41],[30.76,-0.03],[30.42,-1.13],[29.88,-1.13],[29.58,-0.89],[29.59,-0.59],[29.82,-0.21],[29.58,0.59],[31.17,2.2],[31.86,3.77]]]
    }
  },
  KEN: {
    type: "Feature",
    properties: { name: "Kenya" },
    geometry: {
      type: "Polygon",
      coordinates: [[[40.99,-0.86],[41.58,-1.68],[40.88,-2.08],[40.64,-2.5],[40.26,-2.57],[40.12,-3.28],[39.8,-3.68],[39.6,-4.35],[39.2,-4.68],[37.77,-3.68],[37.7,-3.1],[34.07,-1.06],[33.9,0.11],[34.48,1.17],[34.8,1.44],[35.3,1.64],[35.82,1.64],[35.82,4.78],[35.94,5.51],[36.16,6.22],[36.85,5.27],[38.12,3.6],[39.56,3.42],[40.77,4.26],[41.17,3.92],[40.77,2.14],[40.96,-0.86],[40.99,-0.86]]]
    }
  },
  TZA: {
    type: "Feature",
    properties: { name: "Tanzania" },
    geometry: {
      type: "Polygon",
      coordinates: [[[33.9,0.11],[34.07,-1.06],[37.7,-3.1],[37.77,-3.68],[39.2,-4.68],[38.74,-5.91],[38.8,-6.48],[39.44,-6.84],[39.47,-7.1],[39.19,-7.7],[39.25,-8.01],[39.19,-8.49],[39.53,-9.11],[39.28,-10.03],[38.04,-10.96],[37.67,-10.77],[37.46,-11.28],[36.78,-11.59],[36.51,-11.72],[35.31,-11.44],[34.56,-11.52],[34.28,-10.16],[33.94,-9.69],[33.74,-9.42],[32.76,-9.23],[32.19,-8.93],[31.56,-8.76],[31.16,-8.59],[30.74,-8.34],[30.2,-7.08],[29.62,-6.52],[29.42,-5.94],[29.52,-5.42],[29.34,-4.5],[29.02,-4.5],[29.34,-3.29],[29.28,-2.98],[29.02,-2.84],[29.58,-2.74],[30.09,-2.33],[30.47,-2.41],[30.82,-1.47],[30.42,-1.13],[30.76,-0.03],[31.17,2.2],[29.58,0.59],[33.9,0.11]]]
    }
  }
};

export default function Coverage() {
  const [countries, setCountries] = useState<SupportedCountry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCountries() {
      const { data, error } = await supabase
        .from("supported_countries")
        .select("*")
        .eq("is_active", true);

      if (!error && data && data.length > 0) {
        setCountries(data);
      } else {
        // Fallback to DRC
        setCountries([{
          id: 'default-drc',
          country_code: 'COD',
          country_name: 'Democratic Republic of the Congo',
          latitude: -4.0383,
          longitude: 21.7587,
          is_active: true,
        }]);
      }
      setLoading(false);
    }

    fetchCountries();
  }, []);

  const upcomingFiltered = upcomingCountries.filter(
    u => !countries.some(c => c.country_code === u.code)
  );

  // Style for active country polygons
  const activeCountryStyle = {
    fillColor: "#10b981",
    fillOpacity: 0.5,
    color: "#34d399",
    weight: 2,
  };

  // Style for upcoming country polygons
  const upcomingCountryStyle = {
    fillColor: "#f59e0b",
    fillOpacity: 0.25,
    color: "#fbbf24",
    weight: 1,
    dashArray: "5, 5",
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <PublicHeader />

      {/* Hero Section */}
      <section className="relative pt-32 pb-16 overflow-hidden">
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
      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="relative rounded-3xl overflow-hidden bg-slate-900/50 backdrop-blur-sm border border-slate-700/50"
          >
            {loading ? (
              <div className="flex items-center justify-center h-[500px]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
              </div>
            ) : (
              <div className="h-[500px] md:h-[600px] w-full">
                <MapContainer
                  center={[2, 20]}
                  zoom={3}
                  scrollWheelZoom={false}
                  style={{ height: "100%", width: "100%", background: "#0c1322" }}
                  className="rounded-3xl"
                >
                  {/* Dark, muted tile layer - easy on the eyes */}
                  <TileLayer
                    attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
                  />
                  
                  {/* Active countries - filled polygons */}
                  {countries.map((country) => {
                    const geoData = COUNTRY_GEOJSON[country.country_code];
                    return geoData ? (
                      <GeoJSON
                        key={`geo-${country.id}`}
                        data={geoData}
                        style={activeCountryStyle}
                      />
                    ) : null;
                  })}

                  {/* Upcoming countries - dashed polygons */}
                  {upcomingFiltered.map((country) => {
                    const geoData = COUNTRY_GEOJSON[country.code];
                    return geoData ? (
                      <GeoJSON
                        key={`geo-upcoming-${country.code}`}
                        data={geoData}
                        style={upcomingCountryStyle}
                      />
                    ) : null;
                  })}
                  
                  {/* Active country markers */}
                  {countries.map((country) => (
                    <Marker
                      key={country.id}
                      position={[country.latitude, country.longitude]}
                      icon={activeIcon}
                    >
                      <Popup>
                        <div className="text-center p-1">
                          <strong className="text-emerald-600 text-base">{country.country_name}</strong>
                          <p className="text-sm text-gray-600 mt-1">✓ Active Service Zone</p>
                        </div>
                      </Popup>
                    </Marker>
                  ))}

                  {/* Upcoming country markers */}
                  {upcomingFiltered.map((country) => (
                    <Marker
                      key={country.code}
                      position={[country.lat, country.lng]}
                      icon={upcomingIcon}
                    >
                      <Popup>
                        <div className="text-center p-1">
                          <strong className="text-amber-600 text-base">{country.name}</strong>
                          <p className="text-sm text-gray-600 mt-1">Coming Soon</p>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-6 p-6 border-t border-slate-700/50 bg-slate-900/80">
              <div className="flex items-center gap-2 text-sm text-white">
                <div className="w-4 h-4 rounded-full bg-emerald-500" />
                <span>Active Service Zone</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <div className="w-4 h-4 rounded-full bg-amber-500" />
                <span>Coming Soon</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Active Countries Grid */}
      <section className="py-16 px-4">
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
            {countries.map((country, index) => (
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
            ))}
          </div>
        </div>
      </section>

      {/* Coming Soon Section */}
      <section className="py-16 px-4 relative">
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
            {upcomingFiltered.map((country, index) => (
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
