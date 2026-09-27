/**
 * IndexedDB 封装：只存「真实浏览分段」，用于时间线页的精确甘特展示。
 *
 * 结构：
 *   数据库 zhishi-segments（version 1）
 *   └─ object store: segment，keyPath ['date', 'start']，索引 date
 *      行结构 { date: 'YYYY-MM-DD', start: ms, end: ms, domain }
 *
 * 每日/每小时聚合仍在 chrome.storage.local（见 background/store.js），
 * 两套数据由同一次结算双写，永远一致。
 */

const DB_NAME = 'zhishi-segments';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('segment')) {
        const store = db.createObjectStore('segment', { keyPath: ['date', 'start'] });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 批量写入分段（put 语义，同键覆盖）。 */
export async function addSegmentRows(rows) {
  if (!rows?.length) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('segment', 'readwrite');
    const store = tx.objectStore('segment');
    for (const row of rows) store.put(row);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 某一天的全部分段，按开始时间升序。 */
export async function getSegmentsByDate(date) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('segment', 'readonly');
    const req = tx.objectStore('segment').index('date').getAll(date);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.start - b.start));
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 清空全部分段（配合「清除数据」）。 */
export async function clearSegments() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('segment', 'readwrite');
    tx.objectStore('segment').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
