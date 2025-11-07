/* home.js
   Homepage now queries OpenLibrary search for each Top Seller title
   so each homepage book behaves exactly like a Search result.
   - Uses preload's window.bookmarkAPI or ipcRenderer fallback for bookmarks.
   - On card click: fetch full work JSON (if possible), save to localStorage, then navigate.
*/

(function () {
  // ---------- Utilities ----------
  function safeLog(...args) { try { console.log('[HOME]', ...args); } catch (e) {} }
  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
  }

  // IPC bridge: prefer preload's window.bookmarkAPI, fallback to ipcRenderer.invoke
  function getBookmarkAPI() {
    if (window.bookmarkAPI) {
      safeLog('Using window.bookmarkAPI (preload)');
      return {
        add: (b) => window.bookmarkAPI.add(b),
        remove: (id) => window.bookmarkAPI.remove(id),
        isBookmarked: (id) => window.bookmarkAPI.isBookmarked(id),
        getAll: () => window.bookmarkAPI.getAll()
      };
    }
    try {
      // eslint-disable-next-line no-undef
      const { ipcRenderer } = require('electron');
      safeLog('Using ipcRenderer fallback');
      return {
        add: (b) => ipcRenderer.invoke('bookmarks-add', b),
        remove: (id) => ipcRenderer.invoke('bookmarks-remove', id),
        isBookmarked: (id) => ipcRenderer.invoke('bookmarks-check', id),
        getAll: () => ipcRenderer.invoke('bookmarks-get')
      };
    } catch (err) {
      safeLog('No IPC available; bookmark backend disabled.');
      return null;
    }
  }
  const bookmarkAPI = getBookmarkAPI();

  // build deterministic id for books (matches main.js idForBook)
  function idForBook(book) {
    if (!book) return null;
    if (book.key) return book.key;
    return `${book.title || ''}||${(book.author_name && book.author_name[0]) || ''}||${book.cover_i || ''}`;
  }

  // ---------- Titles to search (Top Sellers) ----------
  const TOP_SELLER_TITLES = [
    "Harry Potter and the Philosopher's Stone",
    "The Hobbit",
    "Brave New World",
    "To Kill a Mockingbird",
    "Pride and Prejudice",
    "The Great Gatsby",
    "The Lord of the Rings",
    "The Da Vinci Code",
    "The Maze Runner",
    "The Chronicles of Narnia"
  ];

  // Optional smaller collection sample
  const TOP_COLLECTION_TITLES = [
    "The Hunger Games",  // Changed from "Percy Jackson and the Lightning Thief"
    "Harry Potter and the Sorcerer's Stone",
    "The Da Vinci Code"
  ];

  // ---------- New Categories ----------
  const CATEGORIES = [
    { id: 'fiction', name: '📖 Fiction', query: 'fiction' },
    { id: 'fantasy', name: '🧙‍♂️ Fantasy', query: 'fantasy' },
    { id: 'scienceFiction', name: '🚀 Science Fiction', query: 'science fiction' },
    { id: 'biographies', name: '📝 Biographies', query: 'biography' },
    { id: 'romance', name: '💖 Romance', query: 'romance' },
    { id: 'childrens', name: '🧸 Children\'s', query: 'children' },
    { id: 'history', name: '📜 History', query: 'history' },
    { id: 'religion', name: '🙏 Religion', query: 'religion' }
  ];

  // ---------- OpenLibrary helpers ----------
  async function fetchSearchDocByTitle(title) {
    try {
      const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.docs || !data.docs.length) return null;
      const doc = data.docs[0];

      // Normalize key: prefer a work key like "/works/OLxxxxW"
      if (doc.key && !doc.key.startsWith('/works/')) {
        // If doc.key looks like "/books/OL..." or a raw id, try to coerce to /works/ format when possible.
        // Many search docs have 'key' already as '/works/OLxxxW' but if not, we won't break it.
        // Keep original key if it already starts with '/'
        if (!doc.key.startsWith('/')) {
          doc.key = `/${doc.key}`;
        }
      }

      return doc;
    } catch (err) {
      console.error('fetchSearchDocByTitle failed for', title, err);
      return null;
    }
  }

  async function fetchBooksBySubject(subject, limit = 10) {
    try {
      const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (!data.works || !data.works.length) return [];
      
      // Filter out books without covers and map to consistent format
      const booksWithCovers = data.works
        .filter(work => work.cover_id) // Only books with covers
        .map(work => ({
          title: work.title,
          author_name: work.authors ? work.authors.map(author => author.name) : [],
          cover_i: work.cover_id,
          key: work.key
        }))
        .slice(0, 10); // Ensure we only get 10 books
      
      return booksWithCovers;
    } catch (err) {
      console.error(`fetchBooksBySubject failed for ${subject}:`, err);
      return [];
    }
  }

  async function fetchWorkJson(workKey) {
    try {
      if (!workKey) return null;
      // ensure it begins with '/works/'
      const normalized = workKey.startsWith('/works/') ? workKey : `/works/${workKey.replace(/^\//, '')}`;
      const url = `https://openlibrary.org${normalized}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j;
    } catch (err) {
      console.warn('fetchWorkJson failed for', workKey, err);
      return null;
    }
  }

  // Check if book is marked as read
  function isBookRead(bookId) {
    return localStorage.getItem(`read_${bookId}`) === 'true';
  }

  // ---------- Card creation & behavior ----------
  function makeCard(summaryDoc, bookmarkedSet = new Set()) {
    // summaryDoc is the search result doc (consistent with search page)
    const book = summaryDoc || {};
    const bookId = idForBook(book) || '';
    const isBookmarked = bookmarkedSet.has(bookId);
    const bookmarkedClass = isBookmarked ? 'bookmarked' : '';
    
    // Check if book is already marked as read
    const isRead = isBookRead(bookId);
    const readButtonText = isRead ? '✓ Read' : 'Mark as Read';
    const readButtonClass = isRead ? 'read-btn read' : 'read-btn';

    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <button class="bookmark-btn ${bookmarkedClass}" aria-label="Bookmark" data-id="${escapeHtml(bookId)}">
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path d="M6 2h12v18l-6-3-6 3V2z" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
      </button>
      <div class="cover-wrap">
        <img src="${book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : 'https://via.placeholder.com/300x450?text=No+Cover'}" alt="${escapeHtml(book.title || '')}" />
      </div>
      <h3>${escapeHtml(book.title || 'Unknown Title')}</h3>
      <p class="author">${escapeHtml((book.author_name && (Array.isArray(book.author_name) ? book.author_name.join(', ') : book.author_name)) || 'Unknown Author')}</p>
      <button class="${readButtonClass}">${readButtonText}</button>
    `;

    // Card click -> fetch full work details then navigate (ensures genre/year present in book.html)
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.bookmark-btn') || e.target.closest('.read-btn')) return;

      // We'll attempt to fetch the full work JSON if possible.
      // Some search docs include 'key' set to '/works/OLxxxW', some not.
      let finalBookToSave = book;

      try {
        if (book.key && book.key.startsWith('/works/')) {
          const work = await fetchWorkJson(book.key);
          if (work) {
            // Merge summary doc info into the work object so cover_i/title/authors remain accessible
            // Keep the Work JSON as primary, but copy useful fields
            finalBookToSave = { ...work, title: work.title || book.title, author_name: book.author_name || [], cover_i: book.cover_i || (work.covers ? work.covers[0] : null), key: book.key };
          }
        } else if (book.key) {
          // If key exists but not a work, try fetchWorkJson anyway (function will normalize)
          const work = await fetchWorkJson(book.key);
          if (work) {
            finalBookToSave = { ...work, title: work.title || book.title, author_name: book.author_name || [], cover_i: book.cover_i || (work.covers ? work.covers[0] : null), key: book.key.startsWith('/') ? book.key : `/works/${book.key}` };
          }
        } else if (book.title) {
          // Worst-case: try search by exact title to find a work key, then fetch it
          const doc = await fetchSearchDocByTitle(book.title);
          if (doc && doc.key) {
            const work = await fetchWorkJson(doc.key);
            if (work) {
              finalBookToSave = { ...work, title: work.title || book.title, author_name: doc.author_name || [], cover_i: doc.cover_i || (work.covers ? work.covers[0] : null), key: doc.key };
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch full details for clicked book:', err);
      }

      // Save the fullWork or summary into localStorage and navigate
      try {
        localStorage.setItem('selectedBook', JSON.stringify(finalBookToSave));
      } catch (err) {
        console.error('Failed to set selectedBook in localStorage', err);
      }

      window.location.href = 'book.html';
    });

    // Bookmark handler (same behavior as before)
    const bm = card.querySelector('.bookmark-btn');
    bm.addEventListener('click', async (e) => {
      e.stopPropagation();
      // optimistic UI toggle
      bm.classList.toggle('bookmarked');

      if (!bookmarkAPI) return;

      const id = bookId;
      try {
        const currently = await bookmarkAPI.isBookmarked(id);
        if (currently) {
          await bookmarkAPI.remove(id);
          bm.classList.remove('bookmarked');
        } else {
          await bookmarkAPI.add({
            title: book.title || '',
            author_name: book.author_name || [],
            cover_i: book.cover_i || null,
            key: book.key || null,
            raw: book
          });
          bm.classList.add('bookmarked');
        }
      } catch (err) {
        console.error('Bookmark action failed:', err);
        bm.classList.toggle('bookmarked'); // revert
      }
    });

    // Mark as Read button handler
    const readBtn = card.querySelector('.read-btn');
    readBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      
      const id = bookId;
      const isCurrentlyRead = readBtn.classList.contains('read');
      
      if (isCurrentlyRead) {
        // Mark as unread
        readBtn.classList.remove('read');
        readBtn.textContent = 'Mark as Read';
        localStorage.setItem(`read_${id}`, 'false');
      } else {
        // Mark as read
        readBtn.classList.add('read');
        readBtn.textContent = '✓ Read';
        localStorage.setItem(`read_${id}`, 'true');
        
        // If book is not bookmarked, add it to bookmarks automatically
        if (!isBookmarked && bookmarkAPI) {
          try {
            const currentlyBookmarked = await bookmarkAPI.isBookmarked(id);
            if (!currentlyBookmarked) {
              await bookmarkAPI.add({
                title: book.title || '',
                author_name: book.author_name || [],
                cover_i: book.cover_i || null,
                key: book.key || null,
                raw: book
              });
              // Update bookmark button to show it's now bookmarked
              bm.classList.add('bookmarked');
            }
          } catch (err) {
            console.error('Failed to auto-bookmark when marking as read:', err);
          }
        }
        
        // Show success feedback
        const originalText = readBtn.textContent;
        readBtn.textContent = '✓ Marked!';
        setTimeout(() => {
          readBtn.textContent = originalText;
        }, 1000);
      }
    });

    return card;
  }

  // ---------- Render helpers ----------
  async function renderTitles(containerId, titles) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = ''; // clear

    // Fetch all summaries in parallel, but limit concurrency to be friendly (simple approach: Promise.all here)
    const fetches = titles.map(t => fetchSearchDocByTitle(t));
    const docs = await Promise.all(fetches);

    // preload bookmarked ids if API available
    let bookmarkedSet = new Set();
    if (bookmarkAPI) {
      try {
        const list = await bookmarkAPI.getAll();
        bookmarkedSet = new Set(list.map(b => b._id || b.key || idForBook(b)));
      } catch (err) {
        console.warn('Failed to load bookmarks for home render', err);
      }
    }

    for (const doc of docs) {
      if (!doc) continue;
      const card = makeCard(doc, bookmarkedSet);
      container.appendChild(card);
    }
  }

  async function renderCategory(category) {
    const container = document.querySelector(`#${category.id} .book-grid`);
    if (!container) return;

    container.innerHTML = ''; // clear

    // Fetch books by subject/category
    const books = await fetchBooksBySubject(category.query, 10);
    
    if (books.length === 0) {
      container.innerHTML = `<p class="no-books">No books found for this category.</p>`;
      return;
    }

    // preload bookmarked ids if API available
    let bookmarkedSet = new Set();
    if (bookmarkAPI) {
      try {
        const list = await bookmarkAPI.getAll();
        bookmarkedSet = new Set(list.map(b => b._id || b.key || idForBook(b)));
      } catch (err) {
        console.warn('Failed to load bookmarks for category render', err);
      }
    }

    for (const book of books) {
      const card = makeCard(book, bookmarkedSet);
      container.appendChild(card);
    }
  }

  // ---------- Genre Navigation ----------
  function setupGenreNavigation() {
    const genreButtons = document.querySelectorAll('.genre-btn');
    const genreSections = document.querySelectorAll('.genre-section');
    
    // Hide all genre sections initially except Top
    genreSections.forEach(section => {
      if (section.id !== 'top') {
        section.style.display = 'none';
      }
    });

    genreButtons.forEach(button => {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-target');
        
        // Remove active class from all buttons
        genreButtons.forEach(btn => btn.classList.remove('active'));
        
        // Add active class to clicked button with smooth transition
        button.classList.add('active');
        
        // Hide all genre sections
        genreSections.forEach(section => {
          section.style.display = 'none';
        });
        
        // Show the target section
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          targetSection.style.display = 'block';
          
          // Smooth scroll to the section
          targetSection.scrollIntoView({ 
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });

    // Show Top section by default
    const topSection = document.getElementById('top');
    if (topSection) {
      topSection.style.display = 'block';
    }
  }

  // ---------- Initialization ----------
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Render existing sections
      await renderTitles('topSellers', TOP_SELLER_TITLES);
      await renderTitles('topCollections', TOP_COLLECTION_TITLES);
      
      // Render all categories
      for (const category of CATEGORIES) {
        await renderCategory(category);
      }
      
      // Setup genre navigation
      setupGenreNavigation();
      
      safeLog('Home rendered with all categories and genre navigation.');
    } catch (err) {
      console.error('Home render failed', err);
    }
  });

})();