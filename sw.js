const CACHE_NAME = 'e-reader-cache-v6'; // AUGMENTATION CRITIQUE DU CACHE

// Chemins des fichiers sans le slash initial (/)
const urlsToCache = [
  './', 
  'index.html',
  'styles/main.css',
  'scripts/app.js',
  'https://unpkg.com/epubjs/dist/epub.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs', 
  'manifest.json',
  'images/icon-192x192.png',
  'images/icon-512x512.png'
];

// ... (Reste du code de sw.js inchangé) ...