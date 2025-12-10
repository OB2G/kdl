// ... (Initialisation IndexedDB et fonctions saveBookToDB inchangées) ...

// Fonction modifiée pour extraire le titre de l'EPUB ou utiliser le nom du fichier
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
                const book = ePub(arrayBuffer); // Epub.js peut lire un ArrayBuffer
                book.loaded.metadata.then(metadata => {
                    title = metadata.title || title;
                    saveBookToDB(arrayBuffer, title, type);
                }).catch(() => {
                    // En cas d'échec de lecture des métadonnées, utilise le nom de fichier
                    saveBookToDB(arrayBuffer, title, type);
                });
            } else {
                saveBookToDB(arrayBuffer, title, type);
            }
        };
        reader.readAsArrayBuffer(file);
    }
}

// Fonction modifiée pour afficher plus d'informations
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

// ... (Les fonctions openBook, renderEpub, renderTxt, etc., restent les mêmes) ...

// --- Initialisation Principale (Mise à jour des écouteurs de fichiers) ---
document.addEventListener('DOMContentLoaded', async () => {
    // ... (Enregistrement Service Worker et Initialisation IndexedDB inchangés) ...
    
    await initializeIndexedDB();

    // Écouteur pour le bouton d'importation visible
    document.getElementById('file-input-visible').addEventListener('change', (event) => {
        handleFileImport(event.target.files);
    });

    // Écouteur pour le glisser-déposer (sur toute la zone d'importation)
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

    loadBooksFromDB();
});