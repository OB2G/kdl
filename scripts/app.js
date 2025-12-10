// --- Configuration IndexedDB ---
const DB_NAME = 'eReaderDB';
const DB_VERSION = 1;
let db;

function initializeIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

function saveBookToDB(bookData, title, type) {
    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    const bookRecord = {
        title: title,
        type: type,
        data: bookData, 
        last_read_cfi: null, 
        timestamp: Date.now()
    };
    store.add(bookRecord);
    transaction.oncomplete = loadBooksFromDB;
}

function handleFileImport(files) {
    if (!files || files.length === 0) return;

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const arrayBuffer = e.target.result;
            let title = file.name.split('.').slice(0, -1).join('.');
            const type = file.type || 'application/octet-stream';
            
            // Tentative d'extraction du titre pour les EPUB
            if (type.includes('epub')) {
                try {
                    const book = ePub(arrayBuffer);
                    book.loaded.metadata.then(metadata => {
                        title = metadata.title || title;
                        saveBookToDB(arrayBuffer, title, type);
                    }).catch(() => {
                        saveBookToDB(arrayBuffer, title, type);
                    });
                } catch (error) {
                    console.error("Erreur lors de la lecture de l'EPUB:", error);
                    saveBookToDB(arrayBuffer, title, type);
                }
            } else {
                saveBookToDB(arrayBuffer, title, type);
            }
        };
        reader.readAsArrayBuffer(file);
    }
}


function loadBooksFromDB() {
    const transaction = db.transaction(['books'], 'readonly');
    const store = transaction.objectStore('books');
    const request = store.getAll();
    const bookListElement = document.getElementById('book-list');
    bookListElement.innerHTML = ''; 

    request.onsuccess = () => {
        const books = request.result;
        books.forEach(book => {
            const listItem = document.createElement('li');
            listItem.className = 'book-item';
            listItem.dataset.bookId = book.id;
            
            const displayTitle = book.title.length > 20 ? book.title.substring(0, 17) + '...' : book.title;
            const typeLabel = book.type.includes('epub') ? 'EPUB' : (book.type.includes('pdf') ? 'PDF' : 'TXT');
            const progressStatus = book.last_read_cfi ? 'Lecture en cours' : 'Nouveau';

            listItem.innerHTML = `
                <div class="book-cover">${typeLabel}</div>
                <div class="book-info">
                    <p class="book-title" title="${book.title}">${displayTitle}</p>
                    <p class="book-metadata">Format: ${typeLabel}</p>
                    <p class="book-metadata">Statut: <strong>${progressStatus}</strong></p>
                </div>
            `;
            
            listItem.addEventListener('click', () => openBook(book.id));
            bookListElement.appendChild(listItem);
        });
    };
}


// --- Logique du Lecteur Multi-Format ---
let currentRendition = null;
let currentBookId;
let currentBookType;

function openBook(bookId) {
    currentBookId = bookId;
    const transaction = db.transaction(['books'], 'readonly');
    const store = transaction.objectStore('books');
    const request = store.get(bookId);

    request.onsuccess = () => {
        const book = request.result;
        currentBookType = book.type;
        
        document.getElementById('library-view').style.display = 'none';
        document.getElementById('reader-container').style.display = 'block';

        const epubRenderer = document.getElementById('epub-renderer');
        const staticRenderer = document.getElementById('static-renderer');
        epubRenderer.style.display = 'none';
        staticRenderer.style.display = 'none';
        staticRenderer.innerHTML = ''; 

        const blob = new Blob([book.data], { type: book.type });
        const bookUrl = URL.createObjectURL(blob);
        
        if (book.type.includes('epub')) {
            epubRenderer.style.display = 'block';
            renderEpub(bookUrl, book.last_read_cfi);
            
        } else if (book.type.includes('pdf')) {
            staticRenderer.style.display = 'block';
            renderPdf(book.data, staticRenderer, book.last_read_cfi);

        } else if (book.type.includes('text/plain')) {
            staticRenderer.style.display = 'block';
            renderTxt(book.data, staticRenderer, book.last_read_cfi);
        }
    };
}

// Fonction de rendu EPUB
function renderEpub(bookUrl, cfi) {
    const currentBook = ePub(bookUrl);
    currentRendition = currentBook.renderTo("epub-renderer", {
        width: "100%", height: "100%", flow: "paginated"
    });
    
    if (cfi) {
         currentRendition.display(cfi);
    } else {
         currentRendition.display();
    }

    setupSwipes(); 
    setupSearch(currentBook); 

    currentRendition.on("relocated", (location) => {
        const newCfi = location.start.cfi;
        const pageNumber = location.start.displayed.page || '...';
        document.querySelector('.page-number').textContent = pageNumber;
        saveProgression(newCfi);
    });
}

// Fonction de rendu TXT
function renderTxt(arrayBuffer, container, scrollPosition) {
    currentRendition = null; 
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(arrayBuffer);
    
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.fontFamily = 'Literata, serif';
    pre.style.fontSize = '1em';
    
    container.appendChild(pre);
    
    if (scrollPosition) {
        container.scrollTop = parseInt(scrollPosition);
    }
    
    container.onscroll = debounce(() => {
        saveProgression(container.scrollTop);
    }, 500);
    
    document.querySelector('.page-number').textContent = 'TXT';
}

// Fonction de rendu PDF
function renderPdf(arrayBuffer, container, scrollPosition) {
    currentRendition = null;
    container.onscroll = null;
    
    // pdfjsLib est exporté par pdf.min.mjs (chargé dans index.html)
    if (typeof pdfjsLib === 'undefined') {
        container.innerHTML = '<p>Erreur: PDF.js non chargé correctement. Vérifiez le CDN.</p>';
        return;
    }

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

    loadingTask.promise.then(pdf => {
        container.innerHTML = '';
        const numPages = pdf.numPages;
        
        const renderPage = (pageNum) => {
            if (pageNum > numPages) return;
            
            pdf.getPage(pageNum).then(page => {
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                const canvasContext = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                page.render({ canvasContext, viewport }).promise.then(() => {
                    container.appendChild(canvas);
                    document.querySelector('.page-number').textContent = `${pageNum}/${numPages}`;
                    renderPage(pageNum + 1);
                });
            });
        };
        
        renderPage(1);

    }).catch(error => {
        container.innerHTML = `<p>Erreur lors du rendu PDF: ${error}</p>`;
        console.error("PDF Rendu Erreur:", error);
    });
}

function saveProgression(position) {
    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    const request = store.get(currentBookId);

    request.onsuccess = (e) => {
        const book = e.target.result;
        book.last_read_cfi = position;
        store.put(book);
    };
}

function setupSwipes() {
    if (currentBookType.includes('epub')) {
        const contentArea = document.getElementById('epub-renderer');
        let touchStartX = 0;
        const SWIPE_THRESHOLD = 50;
        
        // Nettoyage des anciens écouteurs (très important)
        contentArea.removeEventListener('touchstart', handleTouchStart);
        contentArea.removeEventListener('touchend', handleTouchEnd);

        contentArea.addEventListener('touchstart', handleTouchStart);
        contentArea.addEventListener('touchend', handleTouchEnd);
        
        function handleTouchStart(e) {
             touchStartX = e.touches[0].clientX;
        }

        function handleTouchEnd(e) {
            const touchEndX = e.changedTouches[0].clientX;
            const deltaX = touchEndX - touchStartX;

            if (Math.abs(deltaX) > SWIPE_THRESHOLD && currentRendition) {
                if (deltaX < 0) {
                    currentRendition.next(); 
                } else {
                    currentRendition.prev(); 
                }
                e.preventDefault();
            }
        }
    }
}

function setupSearch(currentBook) {
    document.querySelector('.search-icon').addEventListener('click', () => {
        if (currentBookType.includes('epub')) {
            const query = prompt("Terme à rechercher dans l'EPUB :");
            if (query) {
                currentRendition.annotations.removeByType("highlight");
                
                currentBook.rendition.search(query).then(results => {
                    if (results.length > 0) {
                        results.forEach(result => {
                            currentRendition.annotations.highlight(result.cfi, {}, null, "highlight");
                        });
                        currentRendition.display(results[0].cfi);
                    } else {
                        alert("Aucun résultat trouvé.");
                    }
                });
            }
        } else {
            alert("La fonction de recherche avancée est disponible uniquement pour les EPUB.");
        }
    });
}

function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Enregistrement du Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        // CORRECTION CRITIQUE DU CHEMIN RELATIF POUR GITHUB PAGES
        navigator.serviceWorker.register('sw.js').catch(error => { 
          console.error('Échec de l\'enregistrement du Service Worker:', error);
        });
      });
    }

    // 2. Initialisation IndexedDB
    await initializeIndexedDB();
    
    // 3. Logique d'importation de fichiers (Bouton et Glisser-Déposer)
    const fileInput = document.getElementById('file-input-id'); 

    // Écouteur pour le bouton d'importation visible
    fileInput.addEventListener('change', (event) => {
        handleFileImport(event.target.files);
    });

    // Écouteur pour le glisser-déposer 
    const importZone = document.getElementById('import-zone');
    
    importZone.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        importZone.style.backgroundColor = '#e0d9c4'; 
    });
    
    importZone.addEventListener('dragleave', () => {
        importZone.style.backgroundColor = '#f7f3e8';
    });

    importZone.addEventListener('drop', (e) => {
        e.preventDefault();
        importZone.style.backgroundColor = '#f7f3e8';
        handleFileImport(e.dataTransfer.files);
    });

    // 4. Charger les livres existants
    loadBooksFromDB();
});