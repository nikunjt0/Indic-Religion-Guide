// Suggestions for the profile language field. Users may enter any value;
// this list only drives the <datalist> autocomplete. Ordered with the most
// commonly selected languages first (English + the 22 scheduled languages),
// then the remaining languages grouped by family for discoverability.
export const INDIAN_LANGUAGES: string[] = [
  // Common defaults
  "English",

  // 22 scheduled languages of India (alphabetical)
  "Assamese",
  "Bengali",
  "Bodo",
  "Dogri",
  "Gujarati",
  "Hindi",
  "Kannada",
  "Kashmiri",
  "Konkani",
  "Maithili",
  "Malayalam",
  "Manipuri (Meitei)",
  "Marathi",
  "Nepali",
  "Odia",
  "Punjabi",
  "Sanskrit",
  "Santali",
  "Sindhi",
  "Tamil",
  "Telugu",
  "Urdu",

  // Indo-Aryan — Hindi Belt / Central Zone
  "Awadhi",
  "Bhojpuri",
  "Braj Bhasha",
  "Magahi",
  "Angika",
  "Bajjika",
  "Chhattisgarhi",
  "Bundeli",
  "Bagheli",
  "Kannauji",
  "Khari Boli",
  "Haryanvi",
  "Sadri (Nagpuri)",

  // Indo-Aryan — Rajasthani cluster
  "Marwari",
  "Mewari",
  "Dhundhari",
  "Shekhawati",
  "Hadoti",
  "Wagdi",
  "Bagri",
  "Mewati",
  "Malvi",
  "Nimadi",

  // Indo-Aryan — Gujarati cluster
  "Kutchi",

  // Indo-Aryan — Punjabi cluster
  "Saraiki (Multani)",
  "Pahari-Pothwari",

  // Indo-Aryan — Western Pahari
  "Kangri",
  "Mandeali",
  "Kullvi",
  "Mahasu Pahari",
  "Chambeali",
  "Bilaspuri",
  "Sirmauri",
  "Kinnauri",

  // Indo-Aryan — Central Pahari
  "Garhwali",
  "Kumaoni",
  "Jaunsari",

  // Indo-Aryan — Bengali-Assamese (eastern)
  "Sylheti",
  "Chakma",
  "Rajbanshi (Kamtapuri)",
  "Hajong",

  // Indo-Aryan — Odia branch
  "Sambalpuri (Kosli)",
  "Bhatri",

  // Indo-Aryan — Marathi-Konkani
  "Varhadi",
  "Ahirani (Khandeshi)",
  "Malvani",

  // Indo-Aryan — Dardic
  "Shina",
  "Brokskat",
  "Kishtwari",
  "Poguli",
  "Kohistani",

  // Indo-Aryan — Nuristani
  "Nuristani",

  // Indo-Aryan — Insular / Nomadic
  "Mahl (Minicoy)",
  "Lambadi (Banjari)",
  "Gaddi",

  // Dravidian — South
  "Tulu",
  "Kodava (Coorgi)",
  "Badaga",
  "Irula",
  "Kurumba",
  "Toda",
  "Kota",
  "Paniya",
  "Kurichiya",
  "Kasaba",
  "Jeseri",

  // Dravidian — South-Central
  "Gondi",
  "Koya",
  "Kui",
  "Kuvi",
  "Konda",
  "Pengo",
  "Manda",

  // Dravidian — Central
  "Kolami",
  "Naiki",
  "Parji",
  "Ollari",
  "Gadaba (Dravidian)",

  // Dravidian — North
  "Kurukh (Oraon)",
  "Malto",
  "Brahui",

  // Austroasiatic — Munda
  "Mundari",
  "Ho",
  "Bhumij",
  "Korku",
  "Kharia",
  "Sora (Saora)",
  "Gta (Didayi)",
  "Juang",
  "Remo (Bonda)",
  "Gorum (Parenga)",
  "Gadaba (Munda)",
  "Turi",
  "Asuri",
  "Birhor",
  "Korwa",

  // Austroasiatic — Khasic
  "Khasi",
  "Pnar (Jaintia)",
  "War",
  "Lyngngam",

  // Austroasiatic — Nicobarese
  "Car Nicobarese",
  "Central Nicobarese",
  "Southern Nicobarese",
  "Shompen",

  // Sino-Tibetan — Bodo-Garo
  "Garo",
  "Dimasa",
  "Kokborok",
  "Rabha",
  "Tiwa",
  "Deori",
  "Koch",
  "Mech",

  // Sino-Tibetan — Kuki-Chin-Mizo
  "Mizo (Lushai)",
  "Hmar",
  "Thadou",
  "Paite",
  "Vaiphei",
  "Gangte",
  "Zou",
  "Simte",
  "Kom",
  "Chiru",
  "Ranglong",
  "Biete",
  "Lai (Pawi)",
  "Mara",

  // Sino-Tibetan — Naga
  "Angami",
  "Ao",
  "Sumi (Sema)",
  "Lotha",
  "Konyak",
  "Phom",
  "Chang",
  "Khiamniungan",
  "Yimchunger",
  "Sangtam",
  "Chakhesang",
  "Pochury",
  "Rengma",
  "Zeliang",
  "Liangmai",
  "Mao",
  "Maram",
  "Poumai",
  "Tangkhul",
  "Anal",
  "Maring",
  "Moyon",
  "Monsang",
  "Lamkang",
  "Tarao",
  "Chothe",
  "Nagamese",

  // Sino-Tibetan — Tani
  "Nyishi",
  "Adi",
  "Padam",
  "Minyong",
  "Galo",
  "Pasi",
  "Bokar",
  "Apatani",
  "Tagin",
  "Hill Miri",
  "Mishing",
  "Na",

  // Sino-Tibetan — Mishmi
  "Idu Mishmi",
  "Digaru (Taraon)",
  "Miju (Kaman)",

  // Sino-Tibetan — Tibetic / Bodish
  "Ladakhi",
  "Balti",
  "Purgi",
  "Zanskari",
  "Spiti Bhoti",
  "Lahauli",
  "Sherdukpen",
  "Monpa",
  "Tawang Monpa",
  "Dirang Monpa",
  "Kalaktang Monpa",
  "Memba",
  "Khamba",
  "Drokpa",
  "Sikkimese Bhutia",
  "Sherpa",
  "Tamang",
  "Gurung",
  "Thakali",

  // Sino-Tibetan — West Himalayan
  "Kanashi",
  "Pattani",
  "Bunan (Gahri)",
  "Tinan",
  "Rongpo",
  "Byangsi",
  "Chaudangsi",
  "Darmiya",

  // Sino-Tibetan — Karbi / Lepcha
  "Karbi",
  "Lepcha",

  // Sino-Tibetan — Arunachal miscellaneous
  "Mru",
  "Tangsa",
  "Nocte",
  "Wancho",
  "Tutsa",
  "Hrusish",
  "Miji",
  "Bangru",
  "Puroik (Sulung)",
  "Koro",

  // Tai-Kadai
  "Tai Khamti",
  "Tai Phake",
  "Tai Aiton",
  "Tai Turung",
  "Tai Khamyang",
  "Tai Ahom",

  // Isolates / Unclassified
  "Nihali (Nahali)",
  "Kusunda",
  "Great Andamanese",
  "Onge",
  "Jarawa",
  "Sentinelese",
];
