// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookmarkAPI', {
  getAll: () => ipcRenderer.invoke('bookmarks-get'),
  add: (book) => ipcRenderer.invoke('bookmarks-add', book),
  remove: (id) => ipcRenderer.invoke('bookmarks-remove', id),
  update: (id, updates) => ipcRenderer.invoke('bookmarks-update', id, updates),
  isBookmarked: (id) => ipcRenderer.invoke('bookmarks-check', id)
});
