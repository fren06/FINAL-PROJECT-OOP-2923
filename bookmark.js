// bookmark.js - with book details, smooth animation, and external remove button
document.addEventListener('DOMContentLoaded', init);

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

function showLoading() {
  const container = document.getElementById('bookmarksList');
  container.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading bookmarks...</p>
    </div>
  `;
}

function hideLoading() {
  const loading = document.querySelector('.loading');
  if (loading) loading.remove();
}

async function init() {
  showLoading();
  
  try {
    const list = await window.bookmarkAPI.getAll();
    const container = document.getElementById('bookmarksList');
    const emptyMsg = document.getElementById('emptyMsg');
    
    hideLoading();
    container.innerHTML = '';

    if (!list || list.length === 0) {
      emptyMsg.style.display = 'block';
      return;
    }
    emptyMsg.style.display = 'none';

    // Sort by added date (newest first)
    list.sort((a, b) => new Date(b.addedAt || b.dateAdded || 0) - new Date(a.addedAt || a.dateAdded || 0));

    // Load book details for all bookmarks
    const bookmarksWithDetails = await Promise.all(
      list.map(async (item) => {
        const details = await fetchBookDetails(item);
        return { ...item, ...details };
      })
    );

    bookmarksWithDetails.forEach(item => {
      const row = createBookmarkRow(item);
      container.appendChild(row);
    });

  } catch (error) {
    hideLoading();
    console.error('Failed to load bookmarks:', error);
    const container = document.getElementById('bookmarksList');
    container.innerHTML = `
      <div class="error-message">
        <p>Failed to load bookmarks. Please try again.</p>
        <button onclick="init()" class="retry-btn">Retry</button>
      </div>
    `;
  }
}

// ✅ Add e-book availability check function
async function checkEbookAvailability(workKey) {
  try {
    if (!workKey) return 'N/A';
    
    const workRes = await fetch(`https://openlibrary.org${workKey}.json`);
    const workData = await workRes.json();
    
    if (workData.ebooks && workData.ebooks.length > 0) {
      return 'Available ✓';
    }
    
    if (workData.availability && workData.availability.ebook) {
      return 'Available ✓';
    }
    
    const editionsRes = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=50`);
    const editionsData = await editionsRes.json();
    
    if (editionsData.entries && editionsData.entries.length > 0) {
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

// Fetch additional book details from OpenLibrary
async function fetchBookDetails(bookmark) {
  try {
    let year = 'Unknown';
    let genre = 'Not specified';
    let editions = 'Unknown';
    let ebook = 'N/A'; // ✅ Added e-book field
    
    // Try to get work data from book key
    if (bookmark.key && bookmark.key.startsWith('/works/')) {
      const response = await fetch(`https://openlibrary.org${bookmark.key}.json`);
      if (response.ok) {
        const workData = await response.json();
        
        // Extract year
        if (workData.first_publish_date) {
          year = workData.first_publish_date;
        } else if (workData.first_publish_year) {
          year = workData.first_publish_year;
        }
        
        // Extract genre (subjects)
        if (workData.subjects && workData.subjects.length > 0) {
          genre = workData.subjects.slice(0, 3).join(', ');
        }
        
        // Extract editions count
        if (workData.covers) {
          editions = workData.covers.length.toString();
        } else if (workData.revision) {
          editions = workData.revision;
        }

        // ✅ Check e-book availability
        ebook = await checkEbookAvailability(bookmark.key);
      }
    }
    
    // If no work data, try searching by title
    else if (bookmark.title) {
      const titleQuery = encodeURIComponent(bookmark.title);
      const searchResponse = await fetch(`https://openlibrary.org/search.json?title=${titleQuery}&limit=1`);
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.docs && searchData.docs.length > 0) {
          const doc = searchData.docs[0];
          
          // Extract year from search result
          if (doc.first_publish_year) {
            year = doc.first_publish_year;
          }
          
          // Extract subjects from search result
          if (doc.subject && doc.subject.length > 0) {
            genre = doc.subject.slice(0, 3).join(', ');
          }
          
          // Editions count from search
          if (doc.edition_count) {
            editions = doc.edition_count.toString();
          }

          // ✅ Check e-book availability using the work key if available
          if (doc.key) {
            const workKey = doc.key.startsWith('/works/') ? doc.key : `/works/${doc.key.replace('/books/', '')}`;
            ebook = await checkEbookAvailability(workKey);
          }
        }
      }
    }
    
    return { year, genre, editions, ebook }; // ✅ Added ebook to return
  } catch (error) {
    console.error('Error fetching book details:', error);
    return {
      year: 'Unknown',
      genre: 'Not specified',
      editions: 'Unknown',
      ebook: 'N/A' // ✅ Added default ebook value
    };
  }
}

function createBookmarkRow(item) {
  const row = document.createElement('div');
  row.className = 'bookmark-row';
  row.dataset.id = item._id;

  // Format bookmark date
  let bookmarkDate = 'Unknown';
  try {
    const date = new Date(item.addedAt || item.dateAdded);
    if (!isNaN(date.getTime())) {
      bookmarkDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
  } catch (e) {
    console.warn('Invalid date format:', item.addedAt);
  }

  // Check if book is already marked as read
  const isRead = localStorage.getItem(`read_${item._id}`) === 'true';
  const readButtonText = isRead ? '✓ Read' : 'Mark as Read';
  const readButtonClass = isRead ? 'read-btn read' : 'read-btn';

  row.innerHTML = `
    <button class="toggle-btn" aria-label="Expand book details" title="Expand">
      <span class="arrow">&#9660;</span>
    </button>
    
    <div class="row-cover">
      <img src="${item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : 'https://via.placeholder.com/150x220?text=No+Cover'}" 
           alt="${escapeHtml(item.title)}"
           loading="lazy"
           class="cover-image">
    </div>
    
    <div class="row-info">
      <h3 class="row-title">${escapeHtml(item.title || 'Unknown Title')}</h3>
      <div class="row-author">${escapeHtml((item.author_name && (Array.isArray(item.author_name) ? item.author_name.join(', ') : item.author_name)) || 'Unknown Author')}</div>
      
      <div class="expanded-content">
        <div class="expanded-top">
          <div class="expanded-details">
            <div class="book-meta-grid">
              <div class="meta-item">
                <strong>Year Published:</strong>
                <span class="meta-value">${escapeHtml(item.year || 'Unknown')}</span>
              </div>
              <div class="meta-item">
                <strong>Genre:</strong>
                <span class="meta-value">${escapeHtml(item.genre || 'Not specified')}</span>
              </div>
              <div class="meta-item">
                <strong>Editions:</strong>
                <span class="meta-value">${escapeHtml(item.editions || 'Unknown')}</span>
              </div>
              <div class="meta-item">
                <strong>E-book:</strong>
                <span class="meta-value">${escapeHtml(item.ebook || 'N/A')}</span>
              </div>
              <div class="meta-item">
                <strong>Bookmarked:</strong>
                <span class="meta-value">${bookmarkDate}</span>
              </div>
            </div>
            
            <label class="review-label" for="review-${item._id}">Your Review:</label>
            <textarea id="review-${item._id}" 
                      class="review-area" 
                      placeholder="Write your thoughts about this book..."
                      aria-label="Book review">${escapeHtml(item.review || '')}</textarea>
            
            <div class="review-actions">
              <button class="save-btn" aria-label="Save review">${item.review ? 'Update Review' : 'Save Review'}</button>
              <button class="delete-review-btn" aria-label="Delete review">Delete Review</button>
              <button class="open-book-btn" aria-label="Open book details">Open Book</button>
              <button class="${readButtonClass}" aria-label="Mark as read">${readButtonText}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- REMOVE BUTTON POSITIONED EXTERNALLY -->
    <div class="row-actions">
      <button class="remove-btn" aria-label="Remove from bookmarks">Remove</button>
    </div>
  `;

  setupRowEventListeners(row, item);
  return row;
}

function setupRowEventListeners(row, item) {
  const toggleBtn = row.querySelector('.toggle-btn');
  const removeBtn = row.querySelector('.remove-btn');
  const saveBtn = row.querySelector('.save-btn');
  const delReviewBtn = row.querySelector('.delete-review-btn');
  const reviewArea = row.querySelector('.review-area');
  const openBookBtn = row.querySelector('.open-book-btn');
  const readBtn = row.querySelector('.read-btn');
  const expandedContent = row.querySelector('.expanded-content');

  // Toggle expand/collapse with smooth animations
  toggleBtn.addEventListener('click', () => {
    const isExpanded = row.classList.toggle('expanded');
    toggleBtn.setAttribute('aria-expanded', isExpanded);
    
    // Add animation class for text content
    if (isExpanded) {
      // Delay text appearance to match image animation
      setTimeout(() => {
        expandedContent.classList.add('content-visible');
      }, 200);
    } else {
      expandedContent.classList.remove('content-visible');
    }
  });

  // Remove bookmark
  removeBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to remove this book from your bookmarks?')) {
      return;
    }

    try {
      removeBtn.disabled = true;
      removeBtn.textContent = 'Removing...';
      
      await window.bookmarkAPI.remove(row.dataset.id);
      row.style.opacity = '0.5';
      
      // Animate removal
      setTimeout(() => {
        row.remove();
        checkEmptyState();
      }, 300);
      
    } catch (error) {
      console.error('Failed to remove bookmark:', error);
      removeBtn.disabled = false;
      removeBtn.textContent = 'Remove';
      alert('Failed to remove bookmark. Please try again.');
    }
  });

  // Save review
  saveBtn.addEventListener('click', async () => {
    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      
      const review = reviewArea.value.trim();
      await window.bookmarkAPI.update(row.dataset.id, { review });
      
      saveBtn.textContent = review ? 'Update Review' : 'Save Review';
      
      // Show success feedback
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ Saved!';
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 1000);
      
    } catch (error) {
      console.error('Failed to save review:', error);
      saveBtn.disabled = false;
      saveBtn.textContent = item.review ? 'Update Review' : 'Save Review';
      alert('Failed to save review. Please try again.');
    }
  });

  // Delete review
  delReviewBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete your review?')) {
      return;
    }

    try {
      reviewArea.value = '';
      await window.bookmarkAPI.update(row.dataset.id, { review: '' });
      saveBtn.textContent = 'Save Review';
      
      // Show feedback
      delReviewBtn.textContent = '✓ Deleted!';
      setTimeout(() => {
        delReviewBtn.textContent = 'Delete Review';
      }, 1000);
      
    } catch (error) {
      console.error('Failed to delete review:', error);
      alert('Failed to delete review. Please try again.');
    }
  });

  // Open book details
  openBookBtn.addEventListener('click', () => {
    // Use raw data if available, otherwise use basic info
    const bookData = item.raw || {
      title: item.title,
      author_name: item.author_name,
      cover_i: item.cover_i,
      key: item.key
    };
    
    try {
      localStorage.setItem('selectedBook', JSON.stringify(bookData));
      window.location.href = 'book.html';
    } catch (error) {
      console.error('Failed to open book:', error);
      alert('Failed to open book details. Please try again.');
    }
  });

  // Mark as Read button
  readBtn.addEventListener('click', () => {
    const isCurrentlyRead = readBtn.classList.contains('read');
    
    if (isCurrentlyRead) {
      // Mark as unread
      readBtn.classList.remove('read');
      readBtn.textContent = 'Mark as Read';
      localStorage.setItem(`read_${item._id}`, 'false');
    } else {
      // Mark as read
      readBtn.classList.add('read');
      readBtn.textContent = '✓ Read';
      localStorage.setItem(`read_${item._id}`, 'true');
      
      // Show success feedback
      const originalText = readBtn.textContent;
      readBtn.textContent = '✓ Marked!';
      setTimeout(() => {
        readBtn.textContent = originalText;
      }, 1000);
    }
  });

  // Auto-save review on blur (optional)
  reviewArea.addEventListener('blur', () => {
    if (reviewArea.value.trim() !== (item.review || '')) {
      saveBtn.click();
    }
  });
}

function checkEmptyState() {
  const remainingRows = document.querySelectorAll('.bookmark-row').length;
  const emptyMsg = document.getElementById('emptyMsg');
  
  if (remainingRows === 0) {
    emptyMsg.style.display = 'block';
  }
}

// Refresh bookmarks list (can be called from console for debugging)
window.refreshBookmarks = init;