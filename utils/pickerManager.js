const logger = require('../config/logger');

class PickerManager {
  constructor() {
    this._sessions = new Map();
    this._latestByUser = new Map();
  }

  _key(userId, sessionId = null) {
    return sessionId ? `${userId}:${sessionId}` : String(userId);
  }

  get(userId, sessionId = null) {
    if (sessionId) return this._sessions.get(this._key(userId, sessionId)) || null;
    const latest = this._latestByUser.get(userId);
    if (latest) return this._sessions.get(this._key(userId, latest)) || null;
    return this._sessions.get(this._key(userId)) || null;
  }

  set(userId, session) {
    const sessionId = session && session.sessionId ? String(session.sessionId) : null;
    this._sessions.set(this._key(userId, sessionId), session);
    if (sessionId) this._latestByUser.set(userId, sessionId);
  }

  delete(userId, sessionId = null) {
    this._sessions.delete(this._key(userId, sessionId));
    if (sessionId && this._latestByUser.get(userId) === sessionId) {
      this._latestByUser.delete(userId);
    }
  }

  cleanupStale() {
    const now = Date.now();
    let count = 0;
    for (const [key, session] of this._sessions) {
      if (now - session.createdAt > session.timeout * 1000) {
        this._sessions.delete(key);
        if (session.sessionId && this._latestByUser.get(session.userId) === session.sessionId) {
          this._latestByUser.delete(session.userId);
        }
        count++;
      }
    }
    if (count) logger.debug(`Picker GC: đã xóa ${count} phiên hết hạn.`);
  }
}

module.exports = PickerManager;
