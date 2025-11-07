// search.js (updated with dynamic popular books)
const queryInput = document.getElementById('query');
const resultsContainer = document.getElementById('results');
const searchContainer = document.querySelector('.search-container');
const searchBtn = document.getElementById('searchBtn');
const popularSection = document.getElementById('popular-section');
const popularBooksContainer = document.getElementById('popular-books');

// Popular book subjects to fetch from OpenLibrary
const POPULAR_SUBJECTS = [
  "bestsellers",
  "fiction",
  "fantasy",
  "romance",
  "mystery"
];

function idForBook(book) {
  if (!book) return null;
  return book.key || `${book.title || ''}||${(book.author_name && book.author_name[0]) || ''}||${book.cover_i || ''}`;
}

// Check if book is marked as read
function isBookRead(bookId) {
  return localStorage.getItem(`read_${bookId}`) === 'true';
}

async function renderBookmarkState(button, book) {
  const id = idForBook(book);
  if (!id) return;
  const is = await window.bookmarkAPI.isBookmarked(id);
  if (is) button.classList.add('bookmarked');
  else button.classList.remove('bookmarked');
}

// Render read state for a book
function renderReadState(button, book) {
  const id = idForBook(book);
  if (!id) return;
  
  const isRead = isBookRead(id);
  if (isRead) {
    button.classList.add('read');
    button.textContent = '✓ Read';
  } else {
    button.classList.remove('read');
    button.textContent = 'Mark as Read';
  }
}

// Fetch books by subject from OpenLibrary (similar to home.js)
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
      }));
    
    return booksWithCovers;
  } catch (err) {
    console.error(`fetchBooksBySubject failed for ${subject}:`, err);
    return [];
  }
}

// Fetch work details for a book (similar to home.js)
async function fetchWorkJson(workKey) {
  try {
    if (!workKey) return null;
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

// Function to create book card (reusable for both popular and search results)
function createBookCard(book) {
  const title = book.title || 'Unknown Title';
  const author = book.author_name ? book.author_name[0] : 'Unknown Author';
  const coverId = book.cover_i;
  const imgSrc = coverId
    ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    : 'https://via.placeholder.com/150x220?text=No+Cover';

  const bookId = idForBook(book);
  const isRead = isBookRead(bookId);
  const readButtonText = isRead ? '✓ Read' : 'Mark as Read';
  const readButtonClass = isRead ? 'read-btn read' : 'read-btn';

  const card = document.createElement('div');
  card.className = 'book-card';
  card.innerHTML = `
    <button class="bookmark-btn" aria-label="Bookmark">
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path d="M6 2h12v18l-6-3-6 3V2z" stroke="currentColor" stroke-width="1.5" fill="none" />
      </svg>
    </button>
    <div class="cover-wrap">
      <img src="${imgSrc}" alt="${title}">
    </div>
    <h3>${title}</h3>
    <p class="author">${author}</p>
    <button class="${readButtonClass}">${readButtonText}</button>
  `;

  const bookmarkBtn = card.querySelector('.bookmark-btn');
  const readBtn = card.querySelector('.read-btn');

  // Set initial bookmark state
  renderBookmarkState(bookmarkBtn, book);

  // Toggle bookmark using bookmarkAPI
  bookmarkBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = idForBook(book);
    if (!id) return;
    const currently = await window.bookmarkAPI.isBookmarked(id);
    if (currently) {
      await window.bookmarkAPI.remove(id);
      bookmarkBtn.classList.remove('bookmarked');
    } else {
      await window.bookmarkAPI.add({
        title: book.title || '',
        author_name: book.author_name || [],
        cover_i: book.cover_i || null,
        key: book.key || null
      });
      bookmarkBtn.classList.add('bookmarked');
    }
  });

  // Mark as Read button handler
  readBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    const id = idForBook(book);
    const isCurrentlyRead = readBtn.classList.contains('read');
    const isCurrentlyBookmarked = bookmarkBtn.classList.contains('bookmarked');
    
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
      if (!isCurrentlyBookmarked && window.bookmarkAPI) {
        try {
          const currentlyBookmarked = await window.bookmarkAPI.isBookmarked(id);
          if (!currentlyBookmarked) {
            await window.bookmarkAPI.add({
              title: book.title || '',
              author_name: book.author_name || [],
              cover_i: book.cover_i || null,
              key: book.key || null
            });
            bookmarkBtn.classList.add('bookmarked');
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

  // Card click for details - fetch full work details like home.js
  card.addEventListener('click', async (e) => {
    if (e.target.closest('.bookmark-btn') || e.target.closest('.read-btn')) return;

    let finalBookToSave = book;

    try {
      if (book.key && book.key.startsWith('/works/')) {
        const work = await fetchWorkJson(book.key);
        if (work) {
          finalBookToSave = { 
            ...work, 
            title: work.title || book.title, 
            author_name: book.author_name || [], 
            cover_i: book.cover_i || (work.covers ? work.covers[0] : null), 
            key: book.key 
          };
        }
      } else if (book.key) {
        const work = await fetchWorkJson(book.key);
        if (work) {
          finalBookToSave = { 
            ...work, 
            title: work.title || book.title, 
            author_name: book.author_name || [], 
            cover_i: book.cover_i || (work.covers ? work.covers[0] : null), 
            key: book.key.startsWith('/') ? book.key : `/works/${book.key}` 
          };
        }
      }
    } catch (err) {
      console.warn('Failed to fetch full details for clicked book:', err);
    }

    try {
      localStorage.setItem('selectedBook', JSON.stringify(finalBookToSave));
    } catch (err) {
      console.error('Failed to set selectedBook in localStorage', err);
    }

    window.location.href = 'book.html';
  });

  return card;
}

// Load popular books from OpenLibrary API
async function loadPopularBooks() {
  popularBooksContainer.innerHTML = '<p>Loading popular books...</p>';
  
  try {
    // Fetch from multiple subjects and combine results
    const allPromises = POPULAR_SUBJECTS.map(subject => fetchBooksBySubject(subject, 2));
    const allResults = await Promise.all(allPromises);
    
    // Flatten and deduplicate books
    const allBooks = allResults.flat();
    const uniqueBooks = [];
    const seenIds = new Set();
    
    for (const book of allBooks) {
      const bookId = idForBook(book);
      if (bookId && !seenIds.has(bookId)) {
        seenIds.add(bookId);
        uniqueBooks.push(book);
      }
      // Stop when we have 5 unique books
      if (uniqueBooks.length >= 5) break;
    }
    
    popularBooksContainer.innerHTML = '';
    
    if (uniqueBooks.length === 0) {
      popularBooksContainer.innerHTML = '<p class="no-results">No popular books found.</p>';
      return;
    }
    
    uniqueBooks.forEach(book => {
      const card = createBookCard(book);
      popularBooksContainer.appendChild(card);
    });
    
  } catch (error) {
    console.error('Failed to load popular books:', error);
    popularBooksContainer.innerHTML = '<p class="no-results">Failed to load popular books.</p>';
  }
}

async function searchBooks() {
  const query = queryInput.value.trim();
  if (!query) return;

  // Hide popular section and show results
  popularSection.classList.add('hidden');
  resultsContainer.style.display = 'grid';
  
  searchContainer.classList.add('top');

  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=30`);
  const data = await res.json();

  resultsContainer.innerHTML = '';

  if (!data.docs.length) {
    resultsContainer.innerHTML = `<p class="no-results">No results found.</p>`;
    return;
  }

  const booksWithCovers = data.docs.filter(book => book.cover_i);

  booksWithCovers.slice(0, 15).forEach(book => {
    const card = createBookCard(book);
    resultsContainer.appendChild(card);
  });
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
  loadPopularBooks();
});

searchBtn.addEventListener('click', searchBooks);
queryInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') searchBooks();
});