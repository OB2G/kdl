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
                <div class="book-cover"></div> 
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

/** NOUVELLE FONCTION: Affiche une erreur visible pour l'utilisateur **/
function displayReaderError(message) {
    const readerContainer = document.getElementById('reader-container');
    
    // Réinitialisation de la vue pour afficher uniquement l'erreur
    readerContainer.innerHTML = `
        <header class="top-bar">
            <button class="menu-icon" onclick="window.location.reload()">📚 Retour à la bibliothèque</button>
        </header>
        <div style="padding: 50px; text-align: center; color: #a00; background-color: #ffe0e0; border: 1px solid #a00; margin: 50px;">
            <h2>Erreur Critique de Rendu</h2>
            <p><strong>Détail:</strong> ${message}</p>
            <p>Le livre n'a pas pu être affiché. Veuillez vérifier que le fichier EPUB/PDF n'est pas corrompu ou protégé par DRM.</p>
        </div>
        <footer class="bottom-bar"></footer>
    `;
    readerContainer.style.display = 'block';
    document.getElementById('library-view').style.display = 'none';
}


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

        // CRITIQUE V13: Nous passons la donnée binaire (ArrayBuffer) directement
        const bookData = book.data; // C'est l'ArrayBuffer
        
        // Ajout d'une petite temporisation pour s'assurer que le DOM est prêt
        setTimeout(() => {
            if (book.type.includes('epub')) {
                epubRenderer.style.display = 'block';
                // Utilisation du try/catch pour attraper les erreurs critiques d'initialisation
                try {
                    // Passe l'ArrayBuffer (bookData) et le type de fichier
                    renderEpub(bookData, book.type, book.last_read_cfi); 
                } catch (e) {
                    displayReaderError("Erreur d'initialisation du moteur EPUB: " + e.message);
                }
                
            } else if (book.type.includes('pdf')) {
                staticRenderer.style.display = 'block';
                renderPdf(