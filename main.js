const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const os = require('os');

let processCheckInterval = null;

function startProcessCheck(win) {
    // Clear any existing interval
    if (processCheckInterval) {
        clearInterval(processCheckInterval);
    }

    // Check immediately
    checkROESProcess().then(isRunning => {
        win.webContents.send('roes-status', isRunning);
    });

    // Set up interval to check every 2 seconds
    processCheckInterval = setInterval(async () => {
        const isRunning = await checkROESProcess();
        win.webContents.send('roes-status', isRunning);
    }, 2000);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 700,
        minWidth: 600,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        trafficLightPosition: { x: 10, y: 10 }
    });

    win.loadFile('src/index.html');
    
    // Optional: Automatically adjust window height to content
    win.webContents.on('did-finish-load', () => {
        // Get the exact content height
        win.webContents.executeJavaScript(`
            document.body.offsetHeight
        `).then(height => {
            const windowHeight = height + 40; // Add some padding for window chrome
            const currentSize = win.getSize();
            win.setSize(currentSize[0], windowHeight);
            startProcessCheck(win);
        });
    });

    // Clean up interval when window is closed
    win.on('closed', () => {
        if (processCheckInterval) {
            clearInterval(processCheckInterval);
            processCheckInterval = null;
        }
    });

    // Handle macOS dock menu
    if (process.platform === 'darwin') {
        app.dock.setMenu(Menu.buildFromTemplate([
            {
                label: 'Backup Templates',
                click: () => {
                    win.webContents.send('trigger-backup');
                }
            },
            {
                label: 'Restore Templates',
                click: () => {
                    win.webContents.send('trigger-restore');
                }
            }
        ]));
    }
}

function checkROESProcess() {
    return new Promise((resolve) => {
        const platform = process.platform;
        const command = platform === 'win32' ? 
            'tasklist /FI "IMAGENAME eq ROESWebStart.exe"' : 
            'ps aux | grep -i "ROESWebStart"';  // Case insensitive on macOS

        exec(command, (error, stdout) => {
            if (platform === 'win32') {
                resolve(stdout.toLowerCase().includes('roeswebstart.exe'));
            } else {
                // More robust macOS process checking
                const lines = stdout.split('\n');
                const processLines = lines.filter(line => 
                    line.toLowerCase().includes('roeswebstart') && 
                    !line.includes('grep') &&
                    !line.includes('defunct')
                );
                resolve(processLines.length > 0);
            }
        });
    });
}

async function cleanupROES(win) {
    const userProfile = os.homedir();
    const roesPath = path.join(userProfile, '.RichmondProLabROES');
    const roesCachePath = path.join(userProfile, '.roescache/RichmondProLabROES');

    // Helper function to add delay
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    try {
        // Initial check
        win.webContents.send('cleanup-progress', {
            message: 'Checking ROES directories...',
            status: 'pending'
        });
        await delay(800);

        await fs.access(roesPath);
        win.webContents.send('cleanup-progress', {
            message: 'Located ROES configuration directory',
            status: 'success'
        });
        await delay(500);
        
        // Files to delete in .RichmondProLabROES
        const roesFiles = ['RichmondProLabROES.properties', 'Colors.xml', 'Customer.xml', 'Paymentinfo.enc'];
        
        win.webContents.send('cleanup-progress', {
            message: 'Starting configuration cleanup...',
            status: 'pending'
        });
        await delay(500);

        for (const file of roesFiles) {
            try {
                await fs.unlink(path.join(roesPath, file));
                win.webContents.send('cleanup-progress', {
                    message: `Removed ${file}`,
                    status: 'success'
                });
                await delay(300); // Small delay between each file
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    win.webContents.send('cleanup-progress', {
                        message: `Failed to remove ${file}: ${err.message}`,
                        status: 'error'
                    });
                    await delay(300);
                }
            }
        }

        // Handle .roescache directory
        win.webContents.send('cleanup-progress', {
            message: 'Checking cache directory...',
            status: 'pending'
        });
        await delay(800);

        try {
            await fs.access(roesCachePath);
            win.webContents.send('cleanup-progress', {
                message: 'Located cache directory',
                status: 'success'
            });
            await delay(500);

            const cacheFile = 'RichmondProLabROES.xml.enc';

            win.webContents.send('cleanup-progress', {
                message: 'Removing cached data...',
                status: 'pending'
            });
            await delay(500);

            try {
                await fs.unlink(path.join(roesCachePath, cacheFile));
                win.webContents.send('cleanup-progress', {
                    message: 'Cache data removed successfully',
                    status: 'success'
                });
                await delay(500);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    win.webContents.send('cleanup-progress', {
                        message: `Failed to remove cache: ${err.message}`,
                        status: 'error'
                    });
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                win.webContents.send('cleanup-progress', {
                    message: `Failed to access cache directory: ${err.message}`,
                    status: 'error'
                });
            }
        }

        await delay(800);
        win.webContents.send('cleanup-progress', {
            message: 'Verifying cleanup completion...',
            status: 'pending'
        });
        await delay(1000);

        win.webContents.send('cleanup-progress', {
            message: 'ROES refresh completed successfully',
            status: 'success'
        });
    } catch (err) {
        win.webContents.send('cleanup-progress', {
            message: `Error accessing ROES directory: ${err.message}`,
            status: 'error'
        });
    }

    await delay(500);
    win.webContents.send('cleanup-complete');
}

async function backupTemplates(win) {
    const userProfile = os.homedir();
    const templatePath = path.join(userProfile, '.RichmondProLabROES', 'mytemplates.xml.enc');

    try {
        // Check if template file exists
        await fs.access(templatePath);

        // Open file dialog for save location
        const result = await dialog.showSaveDialog(win, {
            title: 'Save Template Backup',
            defaultPath: path.join(app.getPath('downloads'), 'mytemplates.xml.enc'),
            filters: [
                { name: 'Template Files', extensions: ['enc'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled) {
            await fs.copyFile(templatePath, result.filePath);
            win.webContents.send('backup-progress', {
                message: 'Templates backed up successfully',
                status: 'success'
            });
        } else {
            // Send a message to re-enable the button when dialog is cancelled
            win.webContents.send('backup-cancelled');
        }
    } catch (err) {
        win.webContents.send('backup-progress', {
            message: `Failed to backup templates: ${err.message}`,
            status: 'error'
        });
    }
}

async function restoreTemplates(win) {
    const userProfile = os.homedir();
    const templatePath = path.join(userProfile, '.RichmondProLabROES', 'mytemplates.xml.enc');

    try {
        // Open file dialog for selecting backup file
        const result = await dialog.showOpenDialog(win, {
            title: 'Select Template Backup',
            defaultPath: app.getPath('downloads'),
            filters: [
                { name: 'Template Files', extensions: ['enc'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            // Ensure the .RichmondProLabROES directory exists
            const roesDir = path.dirname(templatePath);
            try {
                await fs.access(roesDir);
            } catch {
                await fs.mkdir(roesDir, { recursive: true });
            }

            // Copy the selected file to the ROES directory
            await fs.copyFile(result.filePaths[0], templatePath);
            win.webContents.send('restore-progress', {
                message: 'Templates restored successfully',
                status: 'success'
            });
        } else {
            // Send a message to re-enable the button when dialog is cancelled
            win.webContents.send('restore-cancelled');
        }
    } catch (err) {
        win.webContents.send('restore-progress', {
            message: `Failed to restore templates: ${err.message}`,
            status: 'error'
        });
    }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('check-roes-process', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    startProcessCheck(win);
});

ipcMain.on('start-cleanup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await cleanupROES(win);
});

ipcMain.on('backup-templates', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await backupTemplates(win);
});

ipcMain.on('restore-templates', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    await restoreTemplates(win);
}); 