const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const cleanupBtn = document.getElementById('cleanupBtn');
    const backupBtn = document.getElementById('backupBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    const processStatus = document.getElementById('processStatus');
    const processText = document.getElementById('processText');
    const progressList = document.getElementById('progressList');

    function updateProgress(message, status = 'pending') {
        const item = document.createElement('div');
        item.className = `flex items-center space-x-2 ${status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-gray-600'}`;
        item.innerHTML = `
            <span class="w-4 h-4 inline-block">
                ${status === 'success' ? '✓' : status === 'error' ? '✗' : '○'}
            </span>
            <span>${message}</span>
        `;
        progressList.appendChild(item);
    }

    function clearProgress() {
        progressList.innerHTML = '';
    }

    // Check ROES process status on load
    ipcRenderer.send('check-roes-process');

    ipcRenderer.on('roes-status', (event, isRunning) => {
        if (isRunning) {
            processStatus.className = 'w-full h-full rounded-full bg-red-500';
            processText.textContent = 'ROES is running. Please close it first.';
            cleanupBtn.disabled = true;
        } else {
            processStatus.className = 'w-full h-full rounded-full bg-green-500';
            processText.textContent = 'ROES is not running. Safe to proceed.';
            cleanupBtn.disabled = false;
        }
    });

    backupBtn.addEventListener('click', () => {
        backupBtn.disabled = true;
        clearProgress();
        updateProgress('Starting template backup...', 'pending');
        ipcRenderer.send('backup-templates');
    });

    restoreBtn.addEventListener('click', () => {
        restoreBtn.disabled = true;
        clearProgress();
        updateProgress('Starting template restoration...', 'pending');
        ipcRenderer.send('restore-templates');
    });

    cleanupBtn.addEventListener('click', () => {
        cleanupBtn.disabled = true;
        clearProgress();
        updateProgress('Starting ROES refresh...', 'pending');
        ipcRenderer.send('start-cleanup');
    });

    ipcRenderer.on('backup-progress', (event, { message, status }) => {
        updateProgress(message, status);
        backupBtn.disabled = false;
    });

    ipcRenderer.on('restore-progress', (event, { message, status }) => {
        updateProgress(message, status);
        restoreBtn.disabled = false;
    });

    ipcRenderer.on('cleanup-progress', (event, { message, status }) => {
        updateProgress(message, status);
    });

    ipcRenderer.on('cleanup-complete', () => {
        cleanupBtn.disabled = false;
    });

    ipcRenderer.on('trigger-backup', () => {
        if (!backupBtn.disabled) {
            backupBtn.click();
        }
    });

    ipcRenderer.on('trigger-restore', () => {
        if (!restoreBtn.disabled) {
            restoreBtn.click();
        }
    });
}); 