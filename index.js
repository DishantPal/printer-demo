import { app, BrowserWindow, ipcMain, Tray, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os'; // We use this import now
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Store from 'electron-store';
import log from 'electron-log';
import ptp from 'pdf-to-printer';

// --- ESM FIXES FOR DIRNAME ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. CONFIGURATION ---
const store = new Store({
  defaults: {
    port: 4000,
    mappings: [] 
  }
});

// Setup Logging
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs/main.log');
Object.assign(console, log.functions); 

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
  
  // SCAN: Asks Windows for installed printers
  getPrinters: async () => {
    try {
      const printers = await ptp.getPrinters();
      return printers.map(p => p.name); 
    } catch (err) {
      throw err;
    }
  },

  // PRINT: Buffer -> File -> Windows Queue
  print: async (buffer, printerName) => {
    // Create unique temp file
    const tempFilePath = path.join(os.tmpdir(), `crs_job_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.pdf`);
    
    try {
      addLog('INFO', `Preparing job for: ${printerName}`);

      // Write Buffer to Disk
      await fs.promises.writeFile(tempFilePath, buffer);
      
      // Send to Windows Spooler
      await ptp.print(tempFilePath, {
        printer: printerName
      });

      return { success: true };

    } catch (err) {
      throw err;
    } finally {
      // Cleanup
      setTimeout(() => {
        if (fs.existsSync(tempFilePath)) fs.promises.unlink(tempFilePath).catch(()=>{});
      }, 2000);
    }
  }
};

// --- 3. EXPRESS SERVER ---
function startServer() {
  const api = express();
  api.use(cors());
  api.use(bodyParser.json({ limit: '50mb' }));

  api.get('/status', (req, res) => {
    res.json({ status: 'online', mode: 'windows-spooler' });
  });

  api.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  api.post('/print', async (req, res) => {
    const { printerName, base64 } = req.body;
    
    if (!printerName || !base64) return res.status(400).json({ error: "Missing Data" });

    const mappings = store.get('mappings');
    const config = mappings.find(m => m.name === printerName);

    // Fallback: If no mapping, try to use printerName as the printer name directly
    let targetPrinter = config ? config.printer : null;

    if (!targetPrinter) {
        addLog('WARN', `No mapping found for: ${printerName}`);
        return res.status(404).json({ error: `No mapping configured for ${printerName}` });
    }

    try {
      const buffer = Buffer.from(base64, 'base64');
      await PrinterService.print(buffer, targetPrinter);
      
      addLog('SUCCESS', `Sent ${printerName} to "${targetPrinter}"`);
      res.json({ success: true });
    } catch (err) {
      addLog('ERROR', `Print Failed: ${err}`);
      res.status(500).json({ error: String(err) });
    }
  });

  const port = store.get('port');
  server = api.listen(port, () => {
    // FIX: Use 'os' directly, not require('os')
    const nets = os.networkInterfaces();
    let localIp = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) localIp = net.address;
        }
    }
    addLog('SYSTEM', `Server listening at http://${localIp}:${port}`);
  });
}

// --- 4. ELECTRON UI ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, height: 800,
    title: "CRS Printer Service",
    webPreferences: {
      nodeIntegration: true, 
      contextIsolation: false 
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
ipcMain.handle('get-init-data', () => {
  // FIX: Use 'os' directly here too
  const nets = os.networkInterfaces();
  let localIp = 'localhost';
  for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) localIp = net.address;
      }
  }
  return {
    mappings: store.get('mappings'),
    apiUrl: `http://${localIp}:${store.get('port')}/print`
  };
});

ipcMain.handle('save-config', (e, { mappings }) => {
  if (mappings) store.set('mappings', mappings);
  return true;
});

ipcMain.handle('scan-printers', async () => {
  try {
    const printers = await PrinterService.getPrinters();
    return { success: true, printers };
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