import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import ipp from 'ipp';
import ip from 'ip';

// --- CONFIGURATION ---
// Hardcode these for your test so you don't need electron-store
const PRINTER_IP = '10.0.0.43'; // From your screenshot
const PORT = 4000;

// --- PRINTER SERVICE ---
const PrinterService = {
  getUrl: () => `http://${PRINTER_IP}:631/ipp/print`,

  print: (buffer, trayName) => {
    return new Promise((resolve, reject) => {
      const printer = ipp.Printer(PrinterService.getUrl());
      
      // 1. Define Standard Attributes
      const msg = {
        "operation-attributes-tag": {
          "requesting-user-name": "Debug-User",
          "job-name": "Debug-Job",
          "document-format": "application/pdf"
        },
        "job-attributes-tag": {
            // FIX: Use 'media' instead of 'media-source'
            // If trayName is 'auto', we send nothing.
            ...(trayName !== 'auto' && { "media": trayName })
        },
        data: buffer
      };

      console.log(`Sending job to ${PrinterService.getUrl()} using tray: ${trayName || 'auto'}`);

      printer.execute("Print-Job", msg, (err, res) => {
        if (err) {
            console.error("IPP Error:", err);
            return reject(err);
        }
        
        // IPP success codes can be 'successful-ok' or similar variants
        if (res.statusCode.indexOf('successful-ok') === -1) {
            console.error("IPP Status Error:", res.statusCode);
            return reject(res.statusCode);
        }
        
        console.log("Print Success! Job ID:", res['job-attributes-tag']['job-id']);
        resolve(res['job-attributes-tag']['job-id']);
      });
    });
  }
};

// --- EXPRESS SERVER ---
const api = express();
api.use(cors());
api.use(bodyParser.json({ limit: '50mb' }));

api.post('/print', async (req, res) => {
  const { docType, base64 } = req.body;
  
  // For testing, we treat 'docType' directly as the tray name
  // e.g., type "tray-2" in your HTML box to test Tray 2
  const targetTray = docType; 

  try {
    const buffer = Buffer.from(base64, 'base64');
    const jobId = await PrinterService.print(buffer, targetTray);
    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

api.listen(PORT, () => {
  console.log(`\n🚀 DEBUG SERVER RUNNING`);
  console.log(`Target Printer: ${PRINTER_IP}`);
  console.log(`API URL: http://localhost:${PORT}/print`);
  console.log(`------------------------------------------`);
});