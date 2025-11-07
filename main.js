// main.js (updated)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;

function getBookmarksFilePath() {
  // store the JSON inside the project data folder (next to main.js)
  return path.join(__dirname, 'data', 'bookmark.json');
}

async function readBookmarksFile() {
  const file = getBookmarksFilePath();
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text || '[]');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // create folder + empty file
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '[]', 'utf8');
      return [];
    }
    console.error('Error reading bookmarks file:', err);
    throw err;
  }
}

async function writeBookmarksFile(data) {
  const file = getBookmarksFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function idForBook(book) {
  if (!book) return null;
  if (book.key) return book.key;
  return `${book.title || ''}||${(book.author_name && book.author_name[0]) || ''}||${book.cover_i || ''}`;
}

// IPC handlers for bookmark operations
ipcMain.handle('bookmarks-get', async () => {
  return await readBookmarksFile();
});

ipcMain.handle('bookmarks-add', async (event, book) => {
  const list = await readBookmarksFile();
  const id = idForBook(book);
  if (!id) throw new Error('Invalid book data');
  // remove existing with same id then unshift new entry (newest on top)
  const filtered = list.filter(b => b._id !== id);
  const entry = {
    _id: id,
    title: book.title || '',
    author_name: book.author_name || [],
    cover_i: book.cover_i || null,
    key: book.key || null,
    review: book.review || '',
    addedAt: new Date().toISOString(),
    raw: book
  };
  filtered.unshift(entry);
  await writeBookmarksFile(filtered);
  return filtered;
});

ipcMain.handle('bookmarks-remove', async (event, id) => {
  let list = await readBookmarksFile();
  list = list.filter(b => b._id !== id);
  await writeBookmarksFile(list);
  return list;
});

ipcMain.handle('bookmarks-update', async (event, id, updates) => {
  const list = await readBookmarksFile();
  const idx = list.findIndex(b => b._id === id);
  if (idx === -1) throw new Error('Bookmark not found');
  list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
  // move updated item to top
  const [updatedItem] = list.splice(idx, 1);
  list.unshift(updatedItem);
  await writeBookmarksFile(list);
  return list;
});

ipcMain.handle('bookmarks-check', async (event, id) => {
  const list = await readBookmarksFile();
  return list.some(b => b._id === id);
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // make sure preload.js exists
      // nodeIntegration intentionally disabled for security
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'home.html'));

  //mainWindow.webContents.openDevTools(); // enable while debugging
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
