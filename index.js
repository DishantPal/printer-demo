import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Store from 'electron-store';
import log from 'electron-log';
import ipp from 'ipp';
import ip from 'ip';

// --- ESM FIXES FOR DIRNAME ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. CONFIGURATION ---
const store = new Store({
  defaults: {
    printerIp: '192.168.1.50',
    port: 4000,
    mappings: [] 
  }
});

// Setup Logging
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs/main.log');
Object.assign(console, log.functions); // Redirect console.log to file

let mainWindow;
let tray;
let server;

function addLog(type, message) {
  const entry = { timestamp: new Date().toISOString(), type, message };
  log.info(`${type}: ${message}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('new-log', entry);
  }
}

// --- 2. PRINTER SERVICE ---
const PrinterService = {
  getUrl: () => `http://${store.get('printerIp')}:631/ipp/print`,

  scanTrays: () => {
    return new Promise((resolve, reject) => {
      const printer = ipp.Printer(PrinterService.getUrl());
      const msg = { 
        "operation-attributes-tag": { 
          "requested-attributes": ["media-source-supported"] 
        } 
      };
      
      printer.execute("Get-Printer-Attributes", msg, (err, res) => {
        if (err) return reject(err);
        if (res.statusCode !== 'successful-ok') return reject(res.statusCode);
        
        let trays = res['printer-attributes-tag']['media-source-supported'];
        if (!Array.isArray(trays)) trays = [trays];
        resolve(trays);
      });
    });
  },

  print: (buffer, trayName) => {
    return new Promise((resolve, reject) => {
      const printer = ipp.Printer(PrinterService.getUrl());
      const msg = {
        "operation-attributes-tag": {
          "requesting-user-name": "CRS-Service",
          "job-name": "API-Print",
          "document-format": "application/pdf"
        },
        "job-attributes-tag": { 
          ...(trayName !== 'auto' && { "media": trayName })
        },
        data: buffer
      };

      log('INFO', `Sending job to ${PrinterService.getUrl()} using tray: ${trayName || 'auto'}`);
      log('INFO', JSON.stringify(msg, null, 2));

      printer.execute("Print-Job", msg, (err, res) => {
        if (err) return reject(err);
        if (res.statusCode !== 'successful-ok') return reject(res.statusCode);
        resolve(res['job-attributes-tag']['job-id']);
      });
    });
  }
};

// --- 3. EXPRESS SERVER ---
function startServer() {
  const api = express();
  api.use(cors());
  api.use(bodyParser.json({ limit: '50mb' }));

  api.get('/status', (req, res) => {
    res.json({ status: 'online', printer: store.get('printerIp') });
  });

  api.post('/print', async (req, res) => {
    const { docType, base64 } = req.body;
    
    if (!docType || !base64) return res.status(400).json({ error: "Missing Data" });

    const mappings = store.get('mappings');
    const config = mappings.find(m => m.name === docType);

    if (!config) {
      addLog('WARN', `No mapping for: ${docType}`);
      return res.status(404).json({ error: `No mapping for ${docType}` });
    }

    try {
      const buffer = Buffer.from(base64, 'base64');
      const jobId = await PrinterService.print(buffer, config.tray);
      addLog('SUCCESS', `Printed ${docType} (Job ${jobId})`);
      res.json({ success: true, jobId });
    } catch (err) {
      addLog('ERROR', `Print Failed: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  const port = store.get('port');
  server = api.listen(port, () => {
    addLog('SYSTEM', `Server running at http://${ip.address()}:${port}`);
  });
}

// --- 4. ELECTRON UI ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, height: 800,
    title: "CRS Printer Service",
    webPreferences: {
      nodeIntegration: true, 
      contextIsolation: false // Required for simple 2-file architecture
    }
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  // Simple check if icon exists, otherwise empty (prevents crash)
  try { tray = new Tray(iconPath); } catch (e) { tray = new Tray(''); }

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: () => mainWindow.show() },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  
  tray.setToolTip('CRS Printer Service');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

// --- IPC HANDLERS ---
ipcMain.handle('get-init-data', () => ({
  mappings: store.get('mappings'),
  printerIp: store.get('printerIp'),
  apiUrl: `http://${ip.address()}:${store.get('port')}/print`
}));

ipcMain.handle('save-config', (e, { printerIp, mappings }) => {
  if (printerIp) store.set('printerIp', printerIp);
  if (mappings) store.set('mappings', mappings);
  return true;
});

ipcMain.handle('scan-trays', async () => {
  try {
    const trays = await PrinterService.scanTrays();
    return { success: true, trays };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});

// --- STARTUP ---
app.whenReady().then(() => {
  createTray();
  createWindow();
  startServer();
});