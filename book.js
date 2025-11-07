// book.js - robust version that works with preload/contextBridge or nodeIntegration
(async () => {
  // helper to get an IPC interface whether from preload or require
  function getIPC() {
    // If preload exposed bookmarkAPI
    if (window.bookmarkAPI) {
      return {
        getAll: () => window.bookmarkAPI.getAll(),
        add: (b) => window.bookmarkAPI.add(b),
        remove: (id) => window.bookmarkAPI.remove(id),
        update: (id, u) => window.bookmarkAPI.update(id, u),
        isBookmarked: (id) => window.bookmarkAPI.isBookmarked(id)
      };
    }

    // Fallback: try require('electron').ipcRenderer (works only if nodeIntegration true)
    try {
      // eslint-disable-next-line no-undef
      const { ipcRenderer } = require('electron');
      return {
        getAll: () => ipcRenderer.invoke('bookmarks-get'),
        add: (b) => ipcRenderer.invoke('bookmarks-add', b),
        remove: (id) => ipcRenderer.invoke('bookmarks-remove', id),
        update: (id, u) => ipcRenderer.invoke('bookmarks-update', id, u),
        isBookmarked: (id) => ipcRenderer.invoke('bookmarks-check', id)
      };
    } catch (err) {
      console.warn('No IPC available (preload or nodeIntegration). Bookmark actions will be disabled.', err);
      return null;
    }
  }

  const ipc = getIPC();

  // DOM elements
  const titleEl = document.getElementById('book-title');
  const authorEl = document.getElementById('book-author');
  const coverEl = document.getElementById('book-cover');
  const genreEl = document.getElementById('book-genre');
  const yearEl = document.getElementById('book-year');
  const editionsEl = document.getElementById('book-editions');
  const ebookEl = document.getElementById('book-ebook'); // ✅ Added e-book element
  const closeBtn = document.getElementById('closeBtn');
  const bookmarkBtn = document.getElementById('bookmarkBtn');
  const markReadBtn = document.getElementById('markReadBtn');
  const reviewArea = document.getElementById('book-review');
  const saveReviewBtn = document.getElementById('saveReviewBtn');

  // defensive - ensure elements exist
  if (!titleEl || !authorEl || !coverEl) {
    console.error('book.js: expected DOM elements not found. Check that book.html includes book.js after the DOM elements.');
    return;
  }

  // Get selected book from localStorage
  let book = null;
  try {
    book = JSON.parse(localStorage.getItem('selectedBook'));
  } catch (err) {
    console.error('Failed to parse selectedBook from localStorage:', err);
  }

  // If nothing selected, show friendly message and stop
  if (!book) {
    titleEl.textContent = 'No book selected.';
    authorEl.textContent = '';
    coverEl.src = 'https://via.placeholder.com/300x450?text=No+Book+Selected';
    // hide genre/year/editions/ebook if elements present
    if (genreEl) genreEl.textContent = '';
    if (yearEl) yearEl.textContent = '';
    if (editionsEl) editionsEl.textContent = '';
    if (ebookEl) ebookEl.textContent = ''; // ✅ Hide e-book info
    // disable bookmark/save controls if present
    if (bookmarkBtn) bookmarkBtn.disabled = true;
    if (markReadBtn) markReadBtn.disabled = true;
    if (saveReviewBtn) saveReviewBtn.disabled = true;
    console.info('book.js: no selectedBook found in localStorage.');
    return;
  }

  // populate basics
  titleEl.textContent = book.title || 'Unknown Title';
  // keep author formatting safe
  authorEl.textContent = book.author_name ? (Array.isArray(book.author_name) ? book.author_name.join(', ') : String(book.author_name)) : 'Unknown Author';
  coverEl.src = book.cover_i
    ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`
    : (book.cover ? book.cover : 'https://via.placeholder.com/300x450?text=No+Cover');

  // Function to check e-book availability
  async function checkEbookAvailability(workKey) {
    try {
      if (!workKey) return 'N/A';
      
      // Fetch the work to get e-book information
      const workRes = await fetch(`https://openlibrary.org${workKey}.json`);
      const workData = await workRes.json();
      
      // Check for e-book availability in the work data
      if (workData.ebooks && workData.ebooks.length > 0) {
        return 'Available ✓';
      }
      
      // Alternative check: look for availability field
      if (workData.availability && workData.availability.ebook) {
        return 'Available ✓';
      }
      
      // Check if there are any e-book editions
      const editionsRes = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=50`);
      const editionsData = await editionsRes.json();
      
      if (editionsData.entries && editionsData.entries.length > 0) {
        // Check if any edition has e-book format
        const hasEbook = editionsData.entries.some(edition => {
          const formats = edition.ebooks || edition.formats || [];
          return formats.length > 0 || edition.ebook_access === 'public';
        });
        
        if (hasEbook) {
          return 'Available ✓';
        }
      }
      
      return 'N/A';
    } catch (err) {
      console.error('Error checking e-book availability:', err);
      return 'N/A';
    }
  }

  // load details (works key or fallback search)
  async function loadBookDetails() {
    try {
      let workData = null;
      let workKey = null;
      
      if (book.key && book.key.startsWith('/works/')) {
        workKey = book.key;
        const res = await fetch(`https://openlibrary.org${workKey}.json`);
        workData = await res.json();
      } else if (book.title) {
        const titleQuery = encodeURIComponent(book.title);
        const res = await fetch(`https://openlibrary.org/search.json?title=${titleQuery}&limit=1`);
        const searchData = await res.json();
        if (searchData.docs?.length) {
          const doc = searchData.docs[0];
          workKey = doc.key && doc.key.startsWith('/works/') ? doc.key : (doc.key ? `/works/${doc.key.replace('/books/', '')}` : null);
          if (workKey) {
            const res2 = await fetch(`https://openlibrary.org${workKey}.json`);
            workData = await res2.json();
          }
        }
      }
      
      if (workData) {
        if (genreEl) genreEl.textContent = workData.subjects ? workData.subjects.slice(0,3).join(', ') : 'N/A';
        if (yearEl) yearEl.textContent = workData.first_publish_date || workData.first_publish_year || 'N/A';
        if (editionsEl) editionsEl.textContent = workData.revision ?? 'N/A';
        
        // ✅ Check and display e-book availability
        if (ebookEl) {
          ebookEl.textContent = 'Checking...';
          const ebookStatus = await checkEbookAvailability(workKey);
          ebookEl.textContent = ebookStatus;
          
          // Add color coding for e-book status
          if (ebookStatus === 'Available ✓') {
            ebookEl.style.color = 'var(--dark-teal)';
            ebookEl.style.fontWeight = '600';
          } else if (ebookStatus === 'N/A') {
            ebookEl.style.color = 'var(--muted)';
          }
        }
      } else {
        // Set default values if no work data found
        if (genreEl) genreEl.textContent = 'N/A';
        if (yearEl) yearEl.textContent = 'N/A';
        if (editionsEl) editionsEl.textContent = 'N/A';
        if (ebookEl) ebookEl.textContent = 'N/A';
      }
    } catch (err) {
      console.error('Details fetch failed:', err);
      if (genreEl) genreEl.textContent = 'N/A';
      if (yearEl) yearEl.textContent = 'N/A';
      if (editionsEl) editionsEl.textContent = 'N/A';
      if (ebookEl) ebookEl.textContent = 'N/A';
    }
  }
  loadBookDetails();

  // Close button logic - UPDATED TO GO TO HOME PAGE
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.location.href = 'home.html'; // Always go to home page
    });
  }

  // Helper for consistent id
  function idForBook(b) {
    if (!b) return null;
    if (b.key) return b.key;
    return `${b.title||''}||${(b.author_name && (Array.isArray(b.author_name) ? b.author_name[0] : b.author_name))||''}||${b.cover_i||''}`;
  }
  const bookId = idForBook(book);

  // Check if book is marked as read
  function isBookRead(bookId) {
    return localStorage.getItem(`read_${bookId}`) === 'true';
  }

  // Bookmark button behavior with same animation as mark as read button
  if (bookmarkBtn) {
    async function setInitialBookmarkState() {
      if (!ipc) return;
      try {
        const is = await ipc.isBookmarked(bookId);
        if (is) {
          bookmarkBtn.textContent = '✓ Bookmarked';
          bookmarkBtn.classList.add('bookmarked');
        } else {
          bookmarkBtn.textContent = 'Bookmark';
          bookmarkBtn.classList.remove('bookmarked');
        }
      } catch (err) {
        console.warn('Error checking bookmark state:', err);
      }
    }
    setInitialBookmarkState();

    bookmarkBtn.addEventListener('click', async () => {
      // Click animation
      bookmarkBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        bookmarkBtn.style.transform = 'scale(1)';
      }, 150);

      if (!ipc) {
        // fallback: just toggle class and text locally
        const isCurrentlyBookmarked = bookmarkBtn.classList.contains('bookmarked');
        if (isCurrentlyBookmarked) {
          bookmarkBtn.textContent = 'Bookmark';
          bookmarkBtn.classList.remove('bookmarked');
        } else {
          bookmarkBtn.textContent = '✓ Bookmarked';
          bookmarkBtn.classList.add('bookmarked');
          
          // Show success feedback
          const originalText = bookmarkBtn.textContent;
          bookmarkBtn.textContent = '✓ Bookmarked!';
          setTimeout(() => {
            bookmarkBtn.textContent = originalText;
          }, 1000);
        }
        return;
      }
      try {
        const currently = await ipc.isBookmarked(bookId);
        if (currently) {
          await ipc.remove(bookId);
          bookmarkBtn.textContent = 'Bookmark';
          bookmarkBtn.classList.remove('bookmarked');
        } else {
          // add a minimal bookmark entry
          await ipc.add({
            title: book.title || '',
            author_name: book.author_name || [],
            cover_i: book.cover_i || null,
            key: book.key || null,
            raw: book
          });
          bookmarkBtn.textContent = '✓ Bookmarked';
          bookmarkBtn.classList.add('bookmarked');
          
          // Show success feedback
          const originalText = bookmarkBtn.textContent;
          bookmarkBtn.textContent = '✓ Bookmarked!';
          setTimeout(() => {
            bookmarkBtn.textContent = originalText;
          }, 1000);
        }
      } catch (err) {
        console.error('Bookmark toggle failed:', err);
      }
    });
  }

  // Mark as Read button with same animation as home page
  if (markReadBtn) {
    // Set initial read state
    const isRead = isBookRead(bookId);
    if (isRead) {
      markReadBtn.classList.add('read');
      markReadBtn.textContent = '✓ Read';
    } else {
      markReadBtn.classList.remove('read');
      markReadBtn.textContent = 'Mark as Read';
    }

    markReadBtn.addEventListener('click', async () => {
      const isCurrentlyRead = markReadBtn.classList.contains('read');
      
      // Click animation
      markReadBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        markReadBtn.style.transform = 'scale(1)';
      }, 150);

      if (isCurrentlyRead) {
        // Mark as unread
        markReadBtn.classList.remove('read');
        markReadBtn.textContent = 'Mark as Read';
        localStorage.setItem(`read_${bookId}`, 'false');
      } else {
        // Mark as read
        markReadBtn.classList.add('read');
        markReadBtn.textContent = '✓ Read';
        localStorage.setItem(`read_${bookId}`, 'true');
        
        // If book is not bookmarked, add it to bookmarks automatically
        if (bookmarkBtn && !bookmarkBtn.classList.contains('bookmarked') && ipc) {
          try {
            const currentlyBookmarked = await ipc.isBookmarked(bookId);
            if (!currentlyBookmarked) {
              await ipc.add({
                title: book.title || '',
                author_name: book.author_name || [],
                cover_i: book.cover_i || null,
                key: book.key || null,
                raw: book
              });
              // Update bookmark button to show it's now bookmarked
              bookmarkBtn.textContent = '✓ Bookmarked';
              bookmarkBtn.classList.add('bookmarked');
            }
          } catch (err) {
            console.error('Failed to auto-bookmark when marking as read:', err);
          }
        }
        
        // Show success feedback (same as home page)
        const originalText = markReadBtn.textContent;
        markReadBtn.textContent = '✓ Marked!';
        setTimeout(() => {
          markReadBtn.textContent = originalText;
        }, 1000);
      }
    });
  }

  // Review save/update (uses IPC update if available)
  if (saveReviewBtn && reviewArea) {
    // if bookmark exists, prefill review from stored bookmarks
    async function populateSavedReview() {
      if (!ipc) return;
      try {
        const all = await ipc.getAll();
        const found = all.find(b => b._id === bookId || b.key === bookId);
        if (found && found.review) {
          reviewArea.value = found.review;
          saveReviewBtn.textContent = 'Update';
        } else {
          saveReviewBtn.textContent = 'Save';
        }
      } catch (err) {
        console.warn('Could not load saved review:', err);
      }
    }
    populateSavedReview();

    saveReviewBtn.addEventListener('click', async () => {
      const reviewText = reviewArea.value.trim();
      
      // Click animation
      saveReviewBtn.style.transform = 'scale(0.95)';
      setTimeout(() => {
        saveReviewBtn.style.transform = 'scale(1)';
      }, 150);

      if (!ipc) {
        // no ipc: store review in localStorage under a map
        const map = JSON.parse(localStorage.getItem('bookReviews') || '{}');
        if (reviewText) map[bookId] = reviewText;
        else delete map[bookId];
        localStorage.setItem('bookReviews', JSON.stringify(map));
        saveReviewBtn.textContent = reviewText ? 'Update' : 'Save';
        return;
      }

      // If the book is bookmarked, update its review; otherwise add bookmark with review
      try {
        const bookmarked = await ipc.isBookmarked(bookId);
        if (bookmarked) {
          await ipc.update(bookId, { review: reviewText });
        } else {
          await ipc.add({
            title: book.title || '',
            author_name: book.author_name || [],
            cover_i: book.cover_i || null,
            key: book.key || null,
            review: reviewText,
            raw: book
          });
          if (bookmarkBtn) {
            bookmarkBtn.textContent = '✓ Bookmarked';
            bookmarkBtn.classList.add('bookmarked');
          }
        }
        saveReviewBtn.textContent = 'Update';
      } catch (err) {
        console.error('Failed to save review:', err);
      }
    });
  }

})();