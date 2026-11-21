/**
 * MediMate Fullstack Backend Server
 * Powered by Node.js native HTTP & native SQLite Database
 * Featuring Google Authentication and User-isolated Database Sync
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const db = require('./db.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function getSessionUser(req) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['cookie']) {
    const match = req.headers['cookie'].match(/(?:^|;\s*)session=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token) return { user: null, userId: 'local', token: null };
  const user = db.getUserBySession(token);
  return { user: user || null, userId: user ? user.id : 'local', token };
}

function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  if (safePath === '/2_0.html') safePath = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        sendText(res, 404, 'Not Found');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    setCorsHeaders(res);
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Extract Session & Current User
  const { user, userId, token } = getSessionUser(req);
  req.user = user;
  req.userId = userId;
  req.sessionToken = token;

  // API Routes
  if (pathname.startsWith('/api/')) {
    try {
      // 1. Health check
      if (pathname === '/api/health' && method === 'GET') {
        const stats = db.getStats(req.userId);
        return sendJson(res, 200, {
          status: 'ok',
          appName: 'MediMate',
          version: '2.0.0-fullstack',
          uptime: process.uptime(),
          currentUser: req.user ? { id: req.user.id, name: req.user.name, email: req.user.email } : null,
          database: stats
        });
      }

      // 2. Google Authentication Endpoints
      // POST /api/auth/google: Accepts Google JWT ID Token or profile payload
      if (pathname === '/api/auth/google' && method === 'POST') {
        const body = await parseJsonBody(req);
        let googlePayload = null;

        if (body.credential) {
          googlePayload = parseJwt(body.credential);
        } else if (body.user) {
          googlePayload = body.user;
        }

        if (!googlePayload || !googlePayload.email) {
          return sendJson(res, 400, { error: 'Invalid Google credential or missing email' });
        }

        const sub = googlePayload.sub || googlePayload.id || `google_${Buffer.from(googlePayload.email).toString('hex').slice(0, 16)}`;
        const email = googlePayload.email;
        const name = googlePayload.name || googlePayload.email.split('@')[0];
        const picture = googlePayload.picture || '';
        const given_name = googlePayload.given_name || name.split(' ')[0] || '';
        const family_name = googlePayload.family_name || name.split(' ').slice(1).join(' ') || '';
        const locale = googlePayload.locale || 'en';

        // Save/Update user in SQLite database
        const savedUser = db.saveGoogleUser({
          id: sub,
          email,
          name,
          picture,
          given_name,
          family_name,
          locale
        });

        // Migrate local guest data to this user if new
        db.migrateGuestDataToUser(savedUser.id);

        // Create secure session
        const sessionToken = crypto.randomBytes(32).toString('hex');
        db.createSession(sessionToken, savedUser.id);

        // Set session cookie
        res.setHeader('Set-Cookie', `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);

        return sendJson(res, 200, {
          success: true,
          user: savedUser,
          token: sessionToken,
          message: 'Signed in with Google successfully'
        });
      }

      // GET /api/auth/me: Retrieve current authenticated user
      if (pathname === '/api/auth/me' && method === 'GET') {
        return sendJson(res, 200, {
          authenticated: Boolean(req.user),
          user: req.user
        });
      }

      // POST /api/auth/logout: Sign out
      if (pathname === '/api/auth/logout' && method === 'POST') {
        if (req.sessionToken) {
          db.deleteSession(req.sessionToken);
        }
        res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return sendJson(res, 200, { success: true, message: 'Logged out successfully' });
      }

      // GET /api/auth/users: List of all users saved in database
      if (pathname === '/api/auth/users' && method === 'GET') {
        return sendJson(res, 200, db.getAllUsers());
      }

      // 3. Full State (Scoped to current user)
      if (pathname === '/api/state' && method === 'GET') {
        const state = db.getFullState(req.userId);
        return sendJson(res, 200, state);
      }

      // 4. State Sync (Full State Save, scoped to current user)
      if (pathname === '/api/sync' && method === 'POST') {
        const body = await parseJsonBody(req);
        db.saveFullState(body, req.userId);
        return sendJson(res, 200, {
          success: true,
          userId: req.userId,
          message: 'Database state synchronized successfully'
        });
      }

      // 5. Medications CRUD (User scoped)
      if (pathname === '/api/meds') {
        if (method === 'GET') {
          return sendJson(res, 200, db.getAllMeds(req.userId));
        }
        if (method === 'POST') {
          const body = await parseJsonBody(req);
          const created = db.createOrUpdateMed(body, req.userId);
          return sendJson(res, 201, created);
        }
      }

      const medIdMatch = pathname.match(/^\/api\/meds\/([^\/]+)$/);
      if (medIdMatch) {
        const id = decodeURIComponent(medIdMatch[1]);
        if (method === 'GET') {
          const item = db.getMedById(id, req.userId);
          return item ? sendJson(res, 200, item) : sendText(res, 404, 'Medicine not found');
        }
        if (method === 'PUT') {
          const body = await parseJsonBody(req);
          const updated = db.createOrUpdateMed({ ...body, id }, req.userId);
          return sendJson(res, 200, updated);
        }
        if (method === 'DELETE') {
          db.deleteMed(id, req.userId);
          return sendJson(res, 200, { success: true, deletedId: id });
        }
      }

      // 6. Dose Logs (User scoped)
      if (pathname === '/api/logs') {
        if (method === 'POST') {
          const body = await parseJsonBody(req);
          if (!body.key || !body.status) {
            return sendJson(res, 400, { error: 'Missing key or status' });
          }
          const result = db.logDose(body.key, body.status, body.takenAt, req.userId);
          return sendJson(res, 200, result);
        }
      }

      const logKeyMatch = pathname.match(/^\/api\/logs\/([^\/]+)$/);
      if (logKeyMatch) {
        const key = decodeURIComponent(logKeyMatch[1]);
        if (method === 'DELETE') {
          db.undoDose(key, req.userId);
          return sendJson(res, 200, { success: true, undidKey: key });
        }
      }

      // 7. Doctor Questions (User scoped)
      if (pathname === '/api/questions') {
        if (method === 'GET') {
          const state = db.getFullState(req.userId);
          return sendJson(res, 200, state.questions);
        }
        if (method === 'POST') {
          const body = await parseJsonBody(req);
          if (!body.q) return sendJson(res, 400, { error: 'Missing question text' });
          const created = db.addQuestion(body.q, body.date, req.userId);
          return sendJson(res, 201, created);
        }
      }

      const qIdMatch = pathname.match(/^\/api\/questions\/([^\/]+)$/);
      if (qIdMatch && method === 'DELETE') {
        const id = decodeURIComponent(qIdMatch[1]);
        db.deleteQuestion(id, req.userId);
        return sendJson(res, 200, { success: true, deletedId: id });
      }

      // 8. Blood Donors (User scoped)
      if (pathname === '/api/donors') {
        if (method === 'GET') {
          const state = db.getFullState(req.userId);
          return sendJson(res, 200, state.donors);
        }
        if (method === 'POST') {
          const body = await parseJsonBody(req);
          if (!body.name || !body.bg) return sendJson(res, 400, { error: 'Name and blood group required' });
          const created = db.addDonor(body, req.userId);
          return sendJson(res, 201, created);
        }
      }

      const donorIdMatch = pathname.match(/^\/api\/donors\/([^\/]+)$/);
      if (donorIdMatch && method === 'DELETE') {
        const id = decodeURIComponent(donorIdMatch[1]);
        db.deleteDonor(id, req.userId);
        return sendJson(res, 200, { success: true, deletedId: id });
      }

      // 9. Stats
      if (pathname === '/api/stats' && method === 'GET') {
        const stats = db.getStats(req.userId);
        const refCount = db.getAllReferenceMeds().length;
        const genCount = db.getAllGenerics().length;
        return sendJson(res, 200, { ...stats, totalReferenceMedicines: refCount, totalGenericAlternatives: genCount });
      }

      // 10. Medicine Knowledge Base & Reference Database
      if (pathname === '/api/reference/medicines' && method === 'GET') {
        return sendJson(res, 200, db.getAllReferenceMeds());
      }

      const refMedMatch = pathname.match(/^\/api\/reference\/medicines\/([^\/]+)$/);
      if (refMedMatch && method === 'GET') {
        const name = decodeURIComponent(refMedMatch[1]);
        const item = db.getReferenceMedByName(name);
        return item ? sendJson(res, 200, item) : sendJson(res, 404, { error: 'Reference medicine not found' });
      }

      // 11. Generic Alternatives
      if (pathname === '/api/reference/generics' && method === 'GET') {
        const q = reqUrl.searchParams.get('q');
        if (q) {
          return sendJson(res, 200, db.searchGenerics(q));
        }
        return sendJson(res, 200, db.getAllGenerics());
      }

      // 12. Demo Seeding
      if (pathname === '/api/seed' && method === 'POST') {
        const state = db.seedDemoData(req.userId);
        return sendJson(res, 200, { success: true, state });
      }

      // 13. Database Wipe
      if (pathname === '/api/wipe' && method === 'POST') {
        db.wipeAll(req.userId);
        return sendJson(res, 200, { success: true, message: 'Database wiped cleanly for user' });
      }

      // 14. Backup Export
      if (pathname === '/api/backup' && method === 'GET') {
        const state = db.getFullState(req.userId);
        res.setHeader('Content-Disposition', 'attachment; filename="medimate_sqlite_backup.json"');
        return sendJson(res, 200, state);
      }

      // 15. Backup Restore
      if (pathname === '/api/restore' && method === 'POST') {
        const body = await parseJsonBody(req);
        db.saveFullState(body, req.userId);
        return sendJson(res, 200, { success: true, message: 'Backup restored successfully' });
      }

      // Unhandled API Route
      return sendJson(res, 404, { error: 'API route not found', path: pathname });
    } catch (err) {
      console.error('API Error:', err);
      return sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
    }
  }

  // Static files
  serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` MediMate Fullstack Server is running!`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Database: SQLite (Native DatabaseSync)`);
  console.log(` Storage Path: ${db.DB_PATH}`);
  console.log(` Google Auth API: http://localhost:${PORT}/api/auth/google`);
  console.log(`=======================================================`);
});

module.exports = server;
