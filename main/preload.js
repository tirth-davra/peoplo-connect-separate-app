const { contextBridge, ipcRenderer } = require('electron');
const handler = {
    send(channel, value) {
        ipcRenderer.send(channel, value);
    },
    on(channel, callback) {
        const subscription = (_event, ...args) => callback(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
            ipcRenderer.removeListener(channel, subscription);
        };
    },
    invoke(channel, value) {
        return ipcRenderer.invoke(channel, value);
    },
};
contextBridge.exposeInMainWorld('ipc', handler);
contextBridge.exposeInMainWorld('electronAPI', {
    getDisplayMedia: () => ipcRenderer.invoke('get-display-media'),
    mouseMove: (x, y) => ipcRenderer.invoke('mouse-move', x, y),
    mouseClick: (x, y, button) => ipcRenderer.invoke('mouse-click', x, y, button),
    mouseDown: (x, y, button) => ipcRenderer.invoke('mouse-down', x, y, button),
    mouseUp: (x, y, button) => ipcRenderer.invoke('mouse-up', x, y, button),
    getScreenResolution: () => ipcRenderer.invoke('get-screen-resolution'),
    keyTap: (key, modifiers) => ipcRenderer.invoke('key-tap', key, modifiers),
    keyToggle: (key, down, modifiers) => ipcRenderer.invoke('key-toggle', key, down, modifiers)
});
module.exports = { handler };
