CRS Printer Service Documentation

CRS Printer Service
===================

The **CRS Printer Service** is a lightweight, background bridge application designed to enable direct, tray-specific printing from web applications to the **HP LaserJet Enterprise M612**.

It runs a local HTTP server that accepts print jobs via API and routes them to specific printer trays (e.g., _Prescription_ → _Tray 2_) using the IPP protocol, bypassing complex OS driver configurations.

* * *

🚀 Installation Guide
---------------------

### 1\. Install the Application

1.  Download and run the installer: `CRS Printer Service Setup 1.0.0.exe`.
2.  **Windows Security Warning:** Since this is an internal enterprise tool, it is not signed by Microsoft.
    *   If you see _"Windows protected your PC"_:
    *   Click **More Info**.
    *   Click **Run Anyway**.
3.  The application will launch and minimize to the System Tray.

### 2\. Initial Configuration

1.  Open the dashboard (Click the icon in the System Tray or use the Desktop Shortcut).
2.  **Printer IP:** Enter the valid IPv4 address of your HP M612 (e.g., `192.168.1.50`).
3.  **Scan Trays:** Click the "Scan Trays" button.
    *   _Success:_ The dropdown menu will populate with available trays (e.g., `tray-2`, `envelope`).
    *   _Error:_ Check if the printer is on and reachable from this PC.
4.  **Create Mappings:**
    *   Enter a **Logical Name** (e.g., `prescription`, `invoice`, `label`).
    *   Select the target **Tray**.
    *   Click **\+ Add**.

* * *

🔌 API Documentation (For Developers)
-------------------------------------

The service exposes a local REST API endpoint. Your web application (React, Angular, etc.) can send print jobs to this endpoint.

**Base URL:** `http://localhost:4000`

### POST `/print`

Sends a PDF document to the printer.

**Headers:**

*   `Content-Type`: `application/json`

**Body Parameters:**

Parameter

Type

Description

`docType`

`string`

The **Logical Name** configured in the App (e.g., `"prescription"`).

`base64`

`string`

The PDF file content encoded as a Base64 string.

**Example Request (JavaScript):**

    const printJob = async (pdfBase64) => {
      try {
        const response = await fetch('http://localhost:4000/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docType: 'prescription', // Must match a mapping in the App
            base64: pdfBase64        // Do not include "data:application/pdf;base64," prefix
          })
        });
    
        const result = await response.json();
        if (result.success) {
          console.log('Printed successfully! Job ID:', result.jobId);
        }
      } catch (error) {
        console.error('Print service unreachable:', error);
      }
    };

* * *

🛠 Troubleshooting
------------------

### "Unverified Publisher" Warning

*   **Cause:** The application uses a self-signed certificate common for internal tools.
*   **Solution:** This is normal. Select "Run Anyway" during installation.

### Error: `ETIMEDOUT` or `Connection Refused`

*   **Cause:** The PC cannot reach the Printer IP.
*   **Check:**
    1.  Is the Printer IP correct? (Print a Config Report from the printer menu to verify).
    2.  Are the PC and Printer on the same network subnet?
    3.  Is a firewall blocking Port 631?

### Error: `Unknown attribute: media-source`

*   **Cause:** The application failed to handshake with the printer before sending the job.
*   **Solution:** Go to the Dashboard and click **"Scan Trays"**. If scanning fails, the print job will also fail. Fix the network connection first.

* * *

💻 Development (Source Code)
----------------------------

If you need to modify the source code:

1.  **Requirements:** Node.js v18+, pnpm.
2.  **Install Dependencies:**
    
        pnpm install
    
3.  **Run Locally:**
    
        pnpm start
    
4.  **Build Installer (.exe):**
    
        pnpm dist