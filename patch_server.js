import fs from 'fs';
let code = fs.readFileSync('server/server.js', 'utf8');

const target = `import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_HOST = 'generativelanguage.googleapis.com';

async function startServer() {`;

const repl = `import { WebSocketServer, WebSocket } from 'ws';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_HOST = 'generativelanguage.googleapis.com';

// Read config to initialize Firebase Admin
try {
  const firebaseConfigPath = path.join(__dirname, '..', 'firebase-applet-config.json');
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
    admin.initializeApp({ projectId: firebaseConfig.projectId });
    console.log('Firebase Admin initialized with project ID:', firebaseConfig.projectId);
  } else {
    admin.initializeApp();
  }
} catch (e) {
  console.error("Failed to initialize Firebase Admin:", e);
}

// In-memory session tracking
const userSessions = new Map(); // uid -> { date: string, count: number }
const activeConnections = new Map(); // uid -> Set<WebSocket>

async function startServer() {`;

code = code.replace(target, repl);
fs.writeFileSync('server/server.js', code);
