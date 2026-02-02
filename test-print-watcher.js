import fs from 'fs';
import path from 'path';

// ================= CONFIGURATION =================
// Use 'storage' folder in the CURRENT working directory
const STORAGE_DIR = path.join(process.cwd(), 'storage');

// Map the filename -> to a readable prefix
const PRINTER_FILES = {
    'output_tray__1.pdf': 'TRAY_1_STD',
    'output_tray__2.pdf': 'TRAY_2_ENV',
    'output_tray__3.pdf': 'TRAY_3_LEG',
};
// =================================================

console.log("🖨️  STARTING LOCAL PRINTER WATCHER (ESM Mode)...");
console.log(`📂 Working Directory: ${STORAGE_DIR}`);

// 1. SETUP: Create Directory and Placeholder Files
setupEnvironment();

// 2. WATCHER LOGIC
console.log(`👀 Watching for print jobs... (Press Ctrl+C to stop)`);
console.log("---------------------------------------------------");

let processingQueue = new Set();

fs.watch(STORAGE_DIR, (eventType, filename) => {
    if (!filename || !PRINTER_FILES[filename]) return;
    if (processingQueue.has(filename)) return;

    const fullPath = path.join(STORAGE_DIR, filename);

    try {
        // Only process if file exists and has content (size > 0)
        if (!fs.existsSync(fullPath)) return;
        const stats = fs.statSync(fullPath);
        if (stats.size === 0) return; 
    } catch (e) { return; }

    console.log(`⚡ Job detected: ${filename}`);
    processingQueue.add(filename);

    // Wait 500ms for Windows Spooler to release lock
    setTimeout(() => {
        processFile(filename, fullPath);
    }, 500);
});

// 3. RENAME LOGIC
function processFile(filename, sourcePath) {
    const prefix = PRINTER_FILES[filename];
    const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    const newName = `${prefix}_${time}.pdf`;
    const destPath = path.join(STORAGE_DIR, newName);

    try {
        fs.renameSync(sourcePath, destPath);
        console.log(`✅ SUCCESS: Created -> ${newName}`);
        
        // Re-create the empty placeholder immediately
        fs.writeFileSync(sourcePath, '');
        
    } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM') {
            console.log(`⏳ File locked... retrying...`);
            setTimeout(() => processFile(filename, sourcePath), 1000);
            return;
        } else {
            console.error(`❌ Error:`, err.message);
        }
    }
    processingQueue.delete(filename);
}

// 4. CLEANUP ON EXIT
function setupEnvironment() {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    // Create placeholders
    Object.keys(PRINTER_FILES).forEach(filename => {
        const filePath = path.join(STORAGE_DIR, filename);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '');
        }
    });
}

function cleanup() {
    console.log('\n🧹 Cleaning up placeholder files...');
    
    Object.keys(PRINTER_FILES).forEach(filename => {
        const filePath = path.join(STORAGE_DIR, filename);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`   Deleted: ${filename}`);
            } catch (e) { }
        }
    });

    console.log('👋 Bye!');
    process.exit();
}

// Catch Ctrl+C and Exit events
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);