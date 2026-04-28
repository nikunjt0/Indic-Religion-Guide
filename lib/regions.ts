export type RegionZone =
  | "himalayan"
  | "north"
  | "central"
  | "west"
  | "east"
  | "northeast"
  | "south"
  | "islands";

export interface RegionEntry {
  slug: string;
  name: string;
  zone: RegionZone;
  // Approximate cultural centroid — used both as a map anchor and for
  // nearest-region classification of user-entered cities.
  lat: number;
  lon: number;
  // Lower-case city/district/synonym strings. A case-insensitive exact or
  // prefix hit here beats geometric nearest-centroid classification.
  aliases?: string[];
}

export const REGIONS: RegionEntry[] = [
  // ── Himalayan ───────────────────────────────────────────────────────────
  { slug: "kashmir", name: "Kashmir Valley", zone: "himalayan", lat: 34.08, lon: 74.80, aliases: ["srinagar", "baramulla", "anantnag", "kupwara", "pulwama", "budgam", "ganderbal", "koshur", "kashmiri"] },
  { slug: "jammu", name: "Jammu", zone: "himalayan", lat: 32.73, lon: 74.87, aliases: ["jammu", "samba", "kathua", "udhampur", "dogra", "dogri"] },
  { slug: "pir-panjal-chenab", name: "Pir Panjal & Chenab", zone: "himalayan", lat: 33.2, lon: 75.3, aliases: ["poonch", "rajouri", "reasi", "doda", "kishtwar", "ramban", "bhaderwah", "gujjar", "bakarwal"] },
  { slug: "ladakh", name: "Ladakh", zone: "himalayan", lat: 34.17, lon: 77.58, aliases: ["leh", "kargil", "nubra", "zanskar", "ladakhi"] },
  { slug: "kangra", name: "Kangra", zone: "himalayan", lat: 32.10, lon: 76.27, aliases: ["kangra", "dharamshala", "dharamsala", "mcleod ganj", "palampur", "chamba"] },
  { slug: "shimla-hills", name: "Shimla Hills", zone: "himalayan", lat: 31.10, lon: 77.17, aliases: ["shimla", "simla", "solan", "sirmaur", "nahan", "mahasu"] },
  { slug: "kullu-manali", name: "Kullu–Manali", zone: "himalayan", lat: 32.00, lon: 77.10, aliases: ["kullu", "manali", "mandi", "bir", "billing"] },
  { slug: "kinnaur-spiti", name: "Kinnaur–Spiti–Lahaul", zone: "himalayan", lat: 31.90, lon: 78.50, aliases: ["kinnaur", "spiti", "lahaul", "kaza", "reckong peo", "keylong"] },
  { slug: "kumaon", name: "Kumaon", zone: "himalayan", lat: 29.60, lon: 79.50, aliases: ["nainital", "almora", "haldwani", "pithoragarh", "champawat", "bageshwar", "ranikhet", "mukteshwar", "kausani"] },
  { slug: "garhwal", name: "Garhwal", zone: "himalayan", lat: 30.30, lon: 78.80, aliases: ["dehradun", "rishikesh", "haridwar", "tehri", "uttarkashi", "rudraprayag", "chamoli", "badrinath", "kedarnath", "gangotri", "yamunotri", "mussoorie", "pauri"] },

  // ── North (plains) ─────────────────────────────────────────────────────
  { slug: "delhi-ncr", name: "Delhi–NCR", zone: "north", lat: 28.61, lon: 77.21, aliases: ["delhi", "new delhi", "gurgaon", "gurugram", "noida", "greater noida", "ghaziabad", "faridabad", "meerut"] },
  { slug: "majha", name: "Majha (Punjab)", zone: "north", lat: 31.63, lon: 74.87, aliases: ["amritsar", "gurdaspur", "tarn taran", "pathankot", "batala"] },
  { slug: "doaba", name: "Doaba (Punjab)", zone: "north", lat: 31.33, lon: 75.58, aliases: ["jalandhar", "hoshiarpur", "kapurthala", "nawanshahr", "phagwara"] },
  { slug: "malwa-punjab", name: "Malwa (Punjab)", zone: "north", lat: 30.33, lon: 75.85, aliases: ["ludhiana", "patiala", "bathinda", "mansa", "sangrur", "mohali", "chandigarh", "firozpur", "ferozepur", "faridkot", "moga", "barnala"] },
  { slug: "haryana", name: "Haryana", zone: "north", lat: 29.20, lon: 76.50, aliases: ["panipat", "karnal", "rohtak", "hisar", "ambala", "kurukshetra", "panchkula", "sonipat", "jind", "bhiwani", "sirsa", "kaithal", "yamunanagar", "jhajjar", "charkhi dadri", "mahendragarh", "narnaul", "rewari"] },
  { slug: "mewat", name: "Mewat", zone: "north", lat: 27.90, lon: 76.90, aliases: ["nuh", "mewat", "alwar", "bharatpur", "firozpur jhirka", "meo"] },
  { slug: "braj", name: "Braj", zone: "north", lat: 27.50, lon: 77.70, aliases: ["mathura", "vrindavan", "agra", "firozabad", "hathras", "aligarh", "etah", "mainpuri", "barsana", "govardhan"] },
  { slug: "rohilkhand", name: "Rohilkhand", zone: "north", lat: 28.35, lon: 79.42, aliases: ["bareilly", "moradabad", "rampur", "pilibhit", "shahjahanpur", "budaun", "bijnor", "amroha"] },
  { slug: "awadh", name: "Awadh", zone: "north", lat: 26.85, lon: 80.95, aliases: ["lucknow", "ayodhya", "faizabad", "kanpur", "sultanpur", "raebareli", "sitapur", "barabanki", "unnao", "hardoi", "bahraich", "gonda"] },
  { slug: "bhojpur", name: "Bhojpur", zone: "north", lat: 25.60, lon: 84.00, aliases: ["varanasi", "banaras", "benares", "kashi", "prayagraj", "allahabad", "mirzapur", "ballia", "chhapra", "siwan", "ghazipur", "chandauli", "jaunpur", "azamgarh", "gorakhpur", "deoria", "basti", "mau", "arrah", "ara", "buxar"] },
  { slug: "mithila", name: "Mithila", zone: "north", lat: 26.20, lon: 85.90, aliases: ["darbhanga", "madhubani", "sitamarhi", "muzaffarpur", "samastipur", "motihari", "bettiah", "janakpur"] },
  { slug: "magadh", name: "Magadh", zone: "north", lat: 25.20, lon: 85.10, aliases: ["patna", "gaya", "bodhgaya", "nalanda", "bhagalpur", "jehanabad", "nawada", "aurangabad bihar", "biharsharif"] },

  // ── Rajasthan ──────────────────────────────────────────────────────────
  { slug: "marwar", name: "Marwar", zone: "west", lat: 26.30, lon: 73.00, aliases: ["jodhpur", "pali", "jaisalmer", "barmer", "nagaur", "balotra", "sirohi"] },
  { slug: "mewar", name: "Mewar", zone: "west", lat: 24.60, lon: 73.70, aliases: ["udaipur", "chittor", "chittorgarh", "bhilwara", "rajsamand", "banswara", "dungarpur", "pratapgarh", "nathdwara"] },
  { slug: "shekhawati", name: "Shekhawati", zone: "west", lat: 28.10, lon: 75.40, aliases: ["jhunjhunu", "sikar", "churu", "nawalgarh", "mandawa"] },
  { slug: "dhundhar", name: "Dhundhar", zone: "west", lat: 26.90, lon: 75.80, aliases: ["jaipur", "ajmer", "pushkar", "dausa", "tonk", "kishangarh"] },
  { slug: "hadoti", name: "Hadoti", zone: "west", lat: 25.20, lon: 75.90, aliases: ["kota", "bundi", "jhalawar", "baran"] },

  // ── Central ────────────────────────────────────────────────────────────
  { slug: "chambal", name: "Chambal", zone: "central", lat: 26.20, lon: 78.20, aliases: ["gwalior", "morena", "bhind", "dholpur", "shivpuri", "datia"] },
  { slug: "bundelkhand", name: "Bundelkhand", zone: "central", lat: 24.90, lon: 79.20, aliases: ["jhansi", "chhatarpur", "khajuraho", "tikamgarh", "orchha", "sagar", "lalitpur", "banda", "mahoba", "hamirpur", "damoh"] },
  { slug: "baghelkhand", name: "Baghelkhand", zone: "central", lat: 24.50, lon: 81.30, aliases: ["rewa", "satna", "shahdol", "umaria", "sidhi", "singrauli"] },
  { slug: "malwa", name: "Malwa", zone: "central", lat: 23.00, lon: 75.80, aliases: ["indore", "ujjain", "bhopal", "dewas", "ratlam", "mandsaur", "neemuch", "shajapur", "vidisha", "raisen", "sehore"] },
  { slug: "nimar", name: "Nimar", zone: "central", lat: 21.80, lon: 76.30, aliases: ["khandwa", "khargone", "burhanpur", "barwani"] },
  { slug: "mahakoshal", name: "Mahakoshal", zone: "central", lat: 23.20, lon: 79.90, aliases: ["jabalpur", "mandla", "narsinghpur", "seoni", "katni", "chhindwara", "balaghat"] },
  { slug: "chhattisgarh", name: "Chhattisgarh", zone: "central", lat: 21.30, lon: 81.60, aliases: ["raipur", "bilaspur", "durg", "bhilai", "bastar", "jagdalpur", "korba", "rajnandgaon", "dantewada", "kanker"] },

  // ── Gujarat ────────────────────────────────────────────────────────────
  { slug: "kutch", name: "Kutch", zone: "west", lat: 23.20, lon: 69.70, aliases: ["bhuj", "mandvi", "gandhidham", "anjar", "kutchi"] },
  { slug: "saurashtra", name: "Saurashtra", zone: "west", lat: 22.00, lon: 70.80, aliases: ["rajkot", "dwarka", "somnath", "junagadh", "porbandar", "bhavnagar", "jamnagar", "kathiawar", "amreli", "morbi", "gondal"] },
  { slug: "north-gujarat", name: "North Gujarat", zone: "west", lat: 23.10, lon: 72.50, aliases: ["ahmedabad", "gandhinagar", "patan", "mehsana", "palanpur", "banaskantha", "sabarkantha", "himmatnagar"] },
  { slug: "south-gujarat", name: "South Gujarat", zone: "west", lat: 21.20, lon: 72.90, aliases: ["surat", "vadodara", "baroda", "navsari", "valsad", "bharuch", "ankleshwar", "anand", "kheda", "nadiad"] },

  // ── Maharashtra + Konkan + Goa ────────────────────────────────────────
  { slug: "konkan", name: "Konkan", zone: "west", lat: 17.30, lon: 73.30, aliases: ["ratnagiri", "sindhudurg", "raigad", "alibaug", "chiplun", "dapoli", "malvan"] },
  { slug: "mumbai", name: "Mumbai Metropolitan", zone: "west", lat: 19.08, lon: 72.88, aliases: ["mumbai", "bombay", "thane", "navi mumbai", "kalyan", "dombivli", "vasai", "virar"] },
  { slug: "desh-maharashtra", name: "Desh (W Maharashtra)", zone: "west", lat: 18.50, lon: 73.90, aliases: ["pune", "satara", "kolhapur", "sangli", "solapur", "sholapur", "pandharpur", "baramati", "ichalkaranji"] },
  { slug: "khandesh", name: "Khandesh", zone: "west", lat: 20.90, lon: 75.30, aliases: ["jalgaon", "dhule", "nashik", "nandurbar", "malegaon"] },
  { slug: "marathwada", name: "Marathwada", zone: "west", lat: 19.60, lon: 76.30, aliases: ["aurangabad", "sambhajinagar", "chhatrapati sambhajinagar", "nanded", "latur", "beed", "parbhani", "osmanabad", "dharashiv", "jalna", "hingoli"] },
  { slug: "vidarbha", name: "Vidarbha", zone: "west", lat: 21.10, lon: 79.10, aliases: ["nagpur", "amravati", "akola", "yavatmal", "chandrapur", "wardha", "gondia", "buldhana", "washim", "bhandara", "gadchiroli"] },
  { slug: "goa", name: "Goa", zone: "west", lat: 15.40, lon: 74.00, aliases: ["panaji", "panjim", "margao", "madgaon", "vasco", "mapusa", "ponda", "konkani"] },

  // ── East India ─────────────────────────────────────────────────────────
  { slug: "chhotanagpur", name: "Chhotanagpur", zone: "east", lat: 23.30, lon: 85.30, aliases: ["ranchi", "jamshedpur", "bokaro", "dhanbad", "hazaribagh", "ramgarh", "jharkhand", "giridih"] },
  { slug: "santhal-pargana", name: "Santhal Pargana", zone: "east", lat: 24.30, lon: 87.20, aliases: ["dumka", "deoghar", "godda", "jamtara", "sahibganj", "pakur"] },
  { slug: "coastal-odisha", name: "Coastal Odisha", zone: "east", lat: 20.30, lon: 85.80, aliases: ["bhubaneswar", "puri", "cuttack", "balasore", "kendrapara", "jagatsinghpur", "paradip", "jajpur", "khordha"] },
  { slug: "koshal", name: "Koshal (W Odisha)", zone: "east", lat: 21.50, lon: 83.90, aliases: ["sambalpur", "kalahandi", "bolangir", "balangir", "bargarh", "jharsuguda", "sundargarh", "rourkela", "koraput"] },
  { slug: "rarh-bengal", name: "Rarh Bengal", zone: "east", lat: 23.50, lon: 87.50, aliases: ["bardhaman", "burdwan", "birbhum", "santiniketan", "bankura", "purulia", "asansol", "durgapur"] },
  { slug: "gaur-malda", name: "Gaur–Malda", zone: "east", lat: 25.00, lon: 88.10, aliases: ["malda", "murshidabad", "berhampore", "baharampur"] },
  { slug: "kolkata-sundarbans", name: "Kolkata–Sundarbans", zone: "east", lat: 22.57, lon: 88.36, aliases: ["kolkata", "calcutta", "howrah", "hooghly", "north 24 parganas", "south 24 parganas", "barasat", "barrackpore", "nadia", "krishnanagar"] },
  { slug: "north-bengal", name: "North Bengal", zone: "east", lat: 26.72, lon: 88.42, aliases: ["siliguri", "jalpaiguri", "cooch behar", "alipurduar"] },
  { slug: "darjeeling-sikkim", name: "Darjeeling–Sikkim", zone: "east", lat: 27.33, lon: 88.61, aliases: ["darjeeling", "gangtok", "kalimpong", "kurseong", "pelling", "namchi", "pemayangtse", "rumtek", "lepcha", "bhutia"] },

  // ── Northeast ──────────────────────────────────────────────────────────
  { slug: "brahmaputra-valley", name: "Brahmaputra Valley", zone: "northeast", lat: 26.15, lon: 91.74, aliases: ["guwahati", "dispur", "tezpur", "nagaon", "mangaldoi", "barpeta", "assamese"] },
  { slug: "upper-assam", name: "Upper Assam", zone: "northeast", lat: 27.40, lon: 94.90, aliases: ["dibrugarh", "jorhat", "sivasagar", "sibsagar", "tinsukia", "majuli", "golaghat", "lakhimpur"] },
  { slug: "barak-valley", name: "Barak Valley", zone: "northeast", lat: 24.83, lon: 92.80, aliases: ["silchar", "cachar", "hailakandi", "karimganj"] },
  { slug: "bodoland", name: "Bodoland", zone: "northeast", lat: 26.40, lon: 90.30, aliases: ["kokrajhar", "udalguri", "baksa", "chirang", "bodo"] },
  { slug: "meghalaya", name: "Meghalaya", zone: "northeast", lat: 25.58, lon: 91.89, aliases: ["shillong", "tura", "cherrapunji", "jowai", "khasi", "jaintia", "garo"] },
  { slug: "arunachal", name: "Arunachal", zone: "northeast", lat: 27.80, lon: 94.60, aliases: ["itanagar", "tawang", "ziro", "bomdila", "pasighat", "monpa", "nyishi", "adi", "apatani", "mishmi"] },
  { slug: "nagaland", name: "Nagaland", zone: "northeast", lat: 25.90, lon: 94.40, aliases: ["kohima", "dimapur", "mokokchung", "mon", "phek", "wokha", "naga", "angami", "ao", "sumi", "konyak"] },
  { slug: "manipur", name: "Manipur", zone: "northeast", lat: 24.75, lon: 93.90, aliases: ["imphal", "bishnupur", "churachandpur", "thoubal", "meitei", "kuki", "zo"] },
  { slug: "mizoram", name: "Mizoram", zone: "northeast", lat: 23.40, lon: 92.90, aliases: ["aizawl", "lunglei", "champhai", "mizo", "lushai"] },
  { slug: "tripura", name: "Tripura", zone: "northeast", lat: 23.83, lon: 91.28, aliases: ["agartala", "tripuri", "kokborok"] },

  // ── South: Deccan + Karnataka ─────────────────────────────────────────
  { slug: "telangana", name: "Telangana", zone: "south", lat: 17.90, lon: 78.70, aliases: ["hyderabad", "secunderabad", "warangal", "nizamabad", "karimnagar", "khammam", "mahbubnagar", "deccani"] },
  { slug: "rayalaseema", name: "Rayalaseema", zone: "south", lat: 14.70, lon: 78.30, aliases: ["tirupati", "kurnool", "anantapur", "anantapuramu", "cuddapah", "kadapa", "chittoor"] },
  { slug: "coastal-andhra", name: "Coastal Andhra", zone: "south", lat: 16.40, lon: 80.80, aliases: ["vijayawada", "guntur", "visakhapatnam", "vizag", "rajahmundry", "rajamahendravaram", "kakinada", "eluru", "nellore", "ongole", "amaravati", "machilipatnam"] },
  { slug: "hyderabad-karnataka", name: "Kalyana-Karnataka", zone: "south", lat: 17.10, lon: 76.90, aliases: ["kalaburagi", "gulbarga", "raichur", "bidar", "yadgir", "koppal", "ballari", "bellary"] },
  { slug: "bombay-karnataka", name: "Bombay-Karnataka", zone: "south", lat: 15.80, lon: 74.70, aliases: ["belagavi", "belgaum", "dharwad", "hubli", "hubballi", "vijayapura", "bijapur", "bagalkote", "gadag", "haveri", "uttara kannada", "karwar"] },
  { slug: "old-mysore", name: "Old Mysore", zone: "south", lat: 12.97, lon: 77.59, aliases: ["bengaluru", "bangalore", "mysuru", "mysore", "mandya", "hassan", "tumkur", "tumakuru", "kolar", "chikballapur", "chamarajanagar", "ramanagara"] },
  { slug: "malenadu", name: "Malenadu", zone: "south", lat: 13.40, lon: 75.60, aliases: ["chikkamagaluru", "chikmagalur", "shivamogga", "shimoga", "sringeri", "chitradurga", "davangere", "sagara"] },
  { slug: "tulu-nadu", name: "Tulu Nadu", zone: "south", lat: 12.90, lon: 74.90, aliases: ["mangaluru", "mangalore", "udupi", "kasaragod", "manipal", "tulu"] },
  { slug: "kodagu", name: "Kodagu", zone: "south", lat: 12.42, lon: 75.74, aliases: ["coorg", "madikeri", "virajpet", "somwarpet", "kodava"] },

  // ── South: Kerala ──────────────────────────────────────────────────────
  { slug: "malabar", name: "Malabar", zone: "south", lat: 11.50, lon: 75.80, aliases: ["kozhikode", "calicut", "kannur", "cannanore", "wayanad", "palakkad", "malappuram", "mappila"] },
  { slug: "kochi", name: "Kochi & Central Kerala", zone: "south", lat: 10.00, lon: 76.30, aliases: ["ernakulam", "thrissur", "cochin", "kochi", "kottayam", "idukki"] },
  { slug: "travancore", name: "Travancore", zone: "south", lat: 8.70, lon: 76.90, aliases: ["thiruvananthapuram", "trivandrum", "kollam", "alappuzha", "alleppey", "pathanamthitta", "sabarimala"] },

  // ── South: Tamil Nadu ──────────────────────────────────────────────────
  { slug: "kongu", name: "Kongu Nadu", zone: "south", lat: 11.00, lon: 77.30, aliases: ["coimbatore", "erode", "salem", "tiruppur", "namakkal", "dharmapuri", "krishnagiri", "gounder"] },
  { slug: "chola", name: "Chola Nadu", zone: "south", lat: 10.80, lon: 79.10, aliases: ["thanjavur", "tanjore", "kumbakonam", "tiruchirappalli", "trichy", "pudukkottai", "ariyalur", "perambalur", "nagapattinam", "mayiladuthurai"] },
  { slug: "chettinad", name: "Chettinad", zone: "south", lat: 10.17, lon: 78.78, aliases: ["karaikudi", "sivaganga", "devakottai", "chettiar", "nattukottai"] },
  { slug: "pandya", name: "Pandya Nadu", zone: "south", lat: 9.93, lon: 78.12, aliases: ["madurai", "virudhunagar", "theni", "dindigul", "ramanathapuram", "rameshwaram", "sivakasi"] },
  { slug: "nanjil-nadu", name: "Tirunelveli–Nanjil Nadu", zone: "south", lat: 8.73, lon: 77.70, aliases: ["tirunelveli", "nagercoil", "kanyakumari", "tuticorin", "thoothukudi", "nadar"] },
  { slug: "tondai", name: "Chennai–Tondai", zone: "south", lat: 13.00, lon: 80.10, aliases: ["chennai", "madras", "kanchipuram", "vellore", "tiruvallur", "tiruvannamalai", "villupuram", "chengalpattu", "arakkonam"] },

  // ── Islands ────────────────────────────────────────────────────────────
  { slug: "lakshadweep", name: "Lakshadweep", zone: "islands", lat: 10.57, lon: 72.64, aliases: ["kavaratti", "agatti", "minicoy", "amini"] },
  { slug: "andaman-nicobar", name: "Andaman & Nicobar", zone: "islands", lat: 11.74, lon: 92.66, aliases: ["port blair", "havelock", "nicobar", "car nicobar"] },
];

export const REGIONS_BY_SLUG: Record<string, RegionEntry> = Object.fromEntries(
  REGIONS.map((r) => [r.slug, r]),
);

export const ZONE_LABELS: Record<RegionZone, string> = {
  himalayan: "Himalayan",
  north: "North",
  central: "Central",
  west: "West",
  east: "East",
  northeast: "Northeast",
  south: "South",
  islands: "Islands",
};

export const ZONE_COLORS: Record<RegionZone, string> = {
  himalayan: "#4f7fb3",
  north: "#c08a2a",
  central: "#c76b3a",
  west: "#a85b7a",
  east: "#4f9b6b",
  northeast: "#5a8fa8",
  south: "#8f5d9e",
  islands: "#2f8f8f",
};

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Map an arbitrary city name + coordinates to the best-matching cultural
// region. Alias hits win over geometric nearest-centroid; within the alias
// tier, longer (more specific) matches win. Returns null only if both signals
// are absent, which shouldn't happen for any Indian location.
export function classifyCityToRegion(
  name: string,
  lat: number,
  lon: number,
): RegionEntry | null {
  const needle = name.trim().toLowerCase();
  if (needle) {
    let best: { region: RegionEntry; score: number } | null = null;
    for (const r of REGIONS) {
      for (const alias of r.aliases ?? []) {
        if (
          needle === alias ||
          needle.startsWith(`${alias} `) ||
          needle.startsWith(`${alias},`) ||
          needle.includes(` ${alias} `) ||
          needle.endsWith(` ${alias}`)
        ) {
          const score = alias.length;
          if (!best || score > best.score) best = { region: r, score };
        }
      }
    }
    if (best) return best.region;
  }

  let nearest: { region: RegionEntry; dist: number } | null = null;
  for (const r of REGIONS) {
    const d = haversineKm(lat, lon, r.lat, r.lon);
    if (!nearest || d < nearest.dist) nearest = { region: r, dist: d };
  }
  return nearest?.region ?? null;
}
