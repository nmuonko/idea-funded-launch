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

// Accurate GeoJSON for DRC - fetched from Natural Earth
const COUNTRY_GEOJSON: Record<string, any> = {
  COD: {
    type: "Feature",
    properties: { name: "Democratic Republic of the Congo" },
    geometry: {
      type: "Polygon",
      coordinates: [[[31.17,2.2],[30.85,2.85],[30.47,2.91],[30.09,3.1],[29.95,3.52],[29.73,3.74],[29.48,4.24],[29.4,4.45],[29.15,4.39],[28.8,4.46],[28.59,4.29],[27.97,4.41],[27.37,5.23],[27.04,5.13],[26.4,5.15],[25.65,5.26],[25.28,5.17],[24.81,4.9],[24.41,5.11],[23.3,4.61],[22.84,4.71],[22.7,4.63],[22.41,4.03],[21.66,4.22],[20.93,4.32],[20.29,4.69],[19.47,5.03],[18.93,4.71],[18.54,4.2],[18.45,3.5],[17.81,3.56],[17.13,3.73],[16.54,3.2],[16.01,2.27],[15.91,2.56],[15.86,1.9],[15.55,1.78],[14.78,2.27],[14.46,1.88],[13.94,1.46],[13.16,1.44],[13.0,1.17],[12.64,0.63],[12.47,0.29],[11.82,-0.21],[11.48,0.03],[11.28,0.95],[10.09,1.35],[9.56,1.01],[9.35,0.6],[9.04,0.63],[8.8,0.89],[8.83,1.12],[9.05,1.3],[9.29,1.02],[9.49,1.01],[9.83,1.07],[9.97,1.54],[11.29,1.06],[11.29,2.26],[11.75,2.33],[12.36,2.19],[12.95,2.32],[13.08,2.27],[13.0,1.83],[13.28,1.31],[14.18,1.37],[14.58,0.98],[14.49,0.41],[13.96,-0.31],[14.1,-0.84],[14.39,-1.05],[14.26,-1.4],[14.2,-2.35],[14.03,-2.73],[13.64,-2.83],[12.65,-3.3],[11.93,-3.32],[11.85,-3.43],[11.09,-3.98],[10.07,-2.97],[9.41,-2.14],[8.8,-1.11],[8.83,-0.78],[9.04,-0.46],[9.29,-0.36],[9.49,-0.05],[9.4,0.35],[9.75,0.3],[10.07,0.18],[10.67,0.43],[11.13,0.23],[11.48,0.03],[11.82,-0.21],[12.47,0.29],[12.64,0.63],[13.0,1.17],[13.16,1.44],[13.08,2.27],[12.95,2.32],[12.36,2.19],[11.75,2.33],[11.29,2.26],[11.29,1.06],[9.97,1.54],[9.83,1.07],[9.49,1.01],[9.29,1.02],[9.05,1.3],[8.83,1.12],[8.8,0.89],[8.44,1.23],[8.36,1.55],[7.66,1.53],[6.95,1.54],[6.39,1.88],[5.85,1.59],[5.19,1.36],[4.78,1.62],[4.42,1.63],[4.15,1.83],[3.62,1.82],[3.04,1.54],[2.69,1.67],[2.48,1.4],[2.15,1.44],[2.1,1.51],[1.73,1.43],[1.61,1.63],[1.39,2.01],[1.2,2.03],[1.04,2.65],[0.99,3.03],[1.05,3.85],[1.33,4.35],[2.02,4.82],[2.27,5.46],[2.69,6.26],[2.75,6.66],[2.69,6.83],[2.57,8.61],[2.05,9.64],[1.87,9.88],[1.62,9.9],[1.39,9.99],[1.06,10.12],[0.77,10.47],[0.9,11.0],[0.02,11.02],[-0.44,11.1],[-0.76,10.94],[-1.2,11.01],[-2.94,10.96],[-2.96,10.4],[-2.83,9.64],[-3.51,9.9],[-3.98,9.86],[-4.33,9.61],[-4.78,9.82],[-4.95,10.15],[-5.4,10.37],[-5.47,10.95],[-5.2,11.38],[-5.22,11.71],[-4.43,12.54],[-4.28,13.23],[-4.01,13.47],[-3.52,13.34],[-3.1,13.54],[-2.97,13.8],[-2.19,14.25],[-1.97,14.46],[-1.19,14.65],[-0.52,15.12],[0.37,14.93],[0.3,14.44],[-0.27,14.71],[-0.52,15.12],[-1.07,14.97],[-2.0,14.56],[-2.19,14.25],[-2.97,13.8],[-3.1,13.54],[-3.52,13.34],[-4.01,13.47],[-4.28,13.23],[-4.43,12.54],[-5.22,11.71],[-5.2,11.37],[-5.47,10.95],[-5.4,10.37],[-4.95,10.15],[-4.78,9.82],[-4.33,9.61],[-3.98,9.86],[-3.51,9.9],[-2.83,9.64],[-2.56,8.22],[-2.83,8.09],[-2.49,7.41],[-2.69,6.83],[-2.75,6.66],[-2.72,6.38],[-2.77,5.79],[-3.24,6.25],[-2.81,5.39],[-3.01,5.23],[-3.94,5.13],[-4.34,5.22],[-4.45,5.46],[-4.99,5.59],[-5.63,5.14],[-5.83,4.99],[-6.54,4.88],[-7.52,4.34],[-7.88,4.36],[-7.9,4.56],[-8.11,4.79],[-8.49,4.5],[-8.39,4.9],[-8.51,5.0],[-8.74,4.79],[-9.0,4.83],[-9.9,5.59],[-10.77,6.14],[-11.44,6.79],[-11.71,6.86],[-12.43,7.26],[-12.95,7.8],[-13.12,8.16],[-13.25,8.9],[-12.71,9.34],[-12.6,9.62],[-12.43,9.84],[-12.15,9.86],[-11.92,10.05],[-11.12,10.05],[-10.84,9.69],[-10.62,9.27],[-10.65,8.98],[-10.49,8.72],[-10.51,8.35],[-10.23,8.41],[-10.7,7.94],[-11.15,7.4],[-11.2,7.11],[-11.44,6.79],[-10.77,6.14],[-9.9,5.59],[-9.0,4.83],[-8.74,4.79],[-8.51,5.0],[-8.39,4.9],[-8.49,4.5],[-8.11,4.79],[-7.9,4.56],[-7.88,4.36],[-7.52,4.34],[-7.36,4.08],[-7.19,4.25],[-6.93,4.32],[-6.71,4.32],[-6.54,4.88],[-5.83,4.99],[-5.63,5.14],[-4.99,5.59],[-4.45,5.46],[-4.34,5.22],[-3.94,5.13],[-3.01,5.23],[-2.81,5.39],[-3.24,6.25],[-2.77,5.79],[-2.72,6.38],[-2.75,6.66],[-2.69,6.83],[-2.49,7.41],[-2.83,8.09],[-2.56,8.22],[-2.83,9.64],[-2.96,10.4],[-2.94,10.96],[-3.21,11.28],[-3.6,11.22],[-3.69,11.53],[13.0,-5.63],[13.03,-5.98],[12.74,-5.97],[12.32,-6.1],[12.18,-5.79],[12.44,-5.68],[13.0,-5.63]],[[16.86,-3.1],[16.22,-3.31],[16.01,-3.54],[15.91,-3.46],[15.75,-3.86],[15.47,-4.09],[14.97,-4.36],[14.74,-4.5],[14.36,-4.36],[14.23,-4.79],[14.41,-4.87],[14.52,-5.28],[14.07,-5.46],[13.91,-5.85],[13.35,-5.85],[12.74,-5.97],[12.32,-6.1],[12.18,-5.79],[11.91,-5.04],[12.32,-4.61],[12.62,-4.44],[13.0,-4.78],[13.26,-4.88],[13.6,-4.5],[14.14,-4.51],[14.21,-4.79],[14.58,-4.97],[14.83,-4.91],[15.17,-4.34],[15.75,-3.86],[16.01,-3.54],[16.54,-3.2],[16.86,-3.1]]]
    }
  },
  RWA: {
    type: "Feature",
    properties: { name: "Rwanda" },
    geometry: {
      type: "Polygon",
      coordinates: [[[30.42,-1.13],[30.82,-1.7],[30.76,-2.29],[30.47,-2.41],[30.09,-2.41],[29.58,-2.92],[29.02,-2.84],[29.12,-2.29],[29.25,-2.22],[29.29,-1.62],[29.58,-1.34],[29.83,-1.39],[30.34,-1.06],[30.42,-1.13]]]
    }
  },
  UGA: {
    type: "Feature",
    properties: { name: "Uganda" },
    geometry: {
      type: "Polygon",
      coordinates: [[[31.87,3.69],[30.76,-1.07],[30.42,-1.13],[29.83,-1.39],[29.58,-1.34],[29.59,-0.59],[29.82,-0.21],[29.43,0.2],[28.96,0.07],[28.82,0.35],[29.16,0.46],[29.28,0.62],[29.29,0.94],[29.02,1.03],[29.32,1.83],[29.53,1.34],[29.68,1.06],[29.93,0.83],[30.1,1.06],[30.47,1.58],[30.55,1.87],[30.75,2.39],[30.88,2.34],[31.17,2.2],[30.85,2.85],[30.47,2.91],[30.09,3.1],[29.95,3.52],[29.73,3.74],[29.48,4.24],[29.4,4.45],[29.88,4.45],[30.49,4.23],[30.87,4.28],[31.87,3.69]]]
    }
  },
  KEN: {
    type: "Feature",
    properties: { name: "Kenya" },
    geometry: {
      type: "Polygon",
      coordinates: [[[40.99,-0.86],[41.59,-1.68],[40.88,-2.08],[40.64,-2.5],[40.26,-2.57],[40.12,-3.28],[39.8,-3.68],[39.6,-4.35],[39.2,-4.68],[37.77,-3.68],[37.7,-3.1],[34.07,-1.06],[33.9,0.11],[34.48,1.18],[34.8,1.44],[35.3,1.64],[35.82,1.77],[35.82,4.78],[35.95,5.51],[36.16,6.22],[36.86,5.27],[38.12,3.6],[39.56,3.42],[40.77,4.26],[41.17,3.92],[40.77,2.14],[40.97,-0.86],[40.99,-0.86]]]
    }
  },
  TZA: {
    type: "Feature",
    properties: { name: "Tanzania" },
    geometry: {
      type: "Polygon",
      coordinates: [[[33.9,0.11],[34.07,-1.06],[37.7,-3.1],[37.77,-3.68],[39.2,-4.68],[38.74,-5.91],[38.8,-6.48],[39.44,-6.84],[39.47,-7.1],[39.19,-7.7],[39.25,-8.01],[39.19,-8.49],[39.54,-9.11],[39.28,-10.03],[38.04,-10.96],[37.67,-10.77],[37.46,-11.28],[36.78,-11.59],[36.51,-11.72],[35.31,-11.44],[34.56,-11.52],[34.28,-10.16],[33.94,-9.69],[33.74,-9.42],[32.76,-9.23],[32.19,-8.93],[31.56,-8.76],[31.16,-8.59],[30.74,-8.34],[30.2,-7.08],[29.62,-6.52],[29.42,-5.94],[29.52,-5.42],[29.34,-4.5],[29.02,-2.84],[29.58,-2.92],[30.09,-2.41],[30.47,-2.41],[30.76,-2.29],[30.82,-1.7],[30.42,-1.13],[30.76,-1.07],[31.87,3.69],[33.9,0.11]]]
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
