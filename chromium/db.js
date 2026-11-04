export function webURL(value, base) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function hostPermission(value) {
  const url = webURL(value);
  return url ? url.protocol + '//' + url.hostname + '/*' : null;
}

export function pageURL(value, base) {
  const url = webURL(value, base);
  if (!url) return null;
  url.hash = '';
  return url.href;
}

let connection;
function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('cachebuddy', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('archives', {keyPath: 'id'});
      const pages = request.result.createObjectStore('pages', {keyPath: ['archive', 'url']});
      pages.createIndex('url', 'url');
      pages.createIndex('archive', 'archive');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
  });
  return connection;
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listArchives() {
  return result((await database()).transaction('archives').objectStore('archives').getAll());
}

export async function getArchive(id) {
  return result((await database()).transaction('archives').objectStore('archives').get(id));
}

export async function getPage(value, archive) {
  const url = pageURL(value);
  if (!url) return null;
  const pages = (await database()).transaction('pages').objectStore('pages');
  if (archive) return result(pages.get([archive, url]));
  const matches = await result(pages.index('url').getAll(url));
  return matches.sort((a, b) => b.savedAt - a.savedAt)[0];
}

export async function hasPage(value) {
  const url = pageURL(value);
  if (!url) return false;
  const pages = (await database()).transaction('pages').objectStore('pages');
  return Boolean(await result(pages.index('url').getKey(url)));
}

export async function writeArchive(id, archive, pages = []) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['archives', 'pages'], 'readwrite');
    const archiveStore = transaction.objectStore('archives');
    const pageStore = transaction.objectStore('pages');
    const cursor = pageStore.index('archive').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (row) {
        row.delete();
        row.continue();
        return;
      }
      if (archive) {
        archiveStore.put(archive);
        for (const page of pages) pageStore.put({...page, archive: id, savedAt: archive.savedAt});
      } else {
        archiveStore.delete(id);
      }
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('Archive could not be written.'));
  });
}
