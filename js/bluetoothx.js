let device = null;
let ballDataCharacteristic = null;
let controlPointCharacteristic = null;
let statusCharacteristic = null;

export async function connectToR10(serviceUuid, ballDataUuid, controlPointUuid, statusUuid, dotNetRef) {

    window.dotNetRef = dotNetRef; // Store reference for disconnection handler

    try {
        let options = {
            acceptAllDevices: true,
            optionalServices: [serviceUuid]
        };

        console.log('Requesting Bluetooth device...');
        device = await navigator.bluetooth.requestDevice(options);
        
        console.log('Device selected:', device.name);

        // Check if device is already connected to another app
        if (device.gatt.connected) {
            console.warn('Device is already connected. Attempting to disconnect first...');
            device.gatt.disconnect();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        }

        // Listen for disconnection events
        device.addEventListener('gattserverdisconnected', handleDeviceDisconnected);

        // Connect to GATT server
        console.log('Connecting to GATT server...');
        const server = await device.gatt.connect();
        console.log('Connected to GATT server');

        // Get service
        const service = await server.getPrimaryService(serviceUuid);

        // *** Get all three characteristics ***

        // ** status characteristic **

        statusCharacteristic = await service.getCharacteristic(statusUuid);

        // READ status first (important!) <== BULL SH*T
        /* try {
            const statusValue = await statusCharacteristic.readValue();
            const statusBytes = new Uint8Array(statusValue.buffer);
            console.log('Initial status value:', Array.from(statusBytes));
        } catch (e) {
            console.warn('Could not read initial status:', e);
        } */

        // Subscribe to status notifications
        statusCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            console.log('statusCharacteristic triggered');
            console.log('Status value length:', event.target.value.byteLength);
            const value = new Uint8Array(event.target.value.buffer);
            console.log('Status value bytes:', Array.from(value));
            const base64 = btoa(String.fromCharCode.apply(null, value));
            dotNetRef.invokeMethodAsync('OnStatusReceived', base64);
        });
        await statusCharacteristic.startNotifications();

        // ** control point characteristic **

        controlPointCharacteristic = await service.getCharacteristic(controlPointUuid);

        // Log control point properties (don't try to read if not supported)
        /* console.log('Control Point properties:', {
            read: controlPointCharacteristic.properties.read,
            write: controlPointCharacteristic.properties.write,
            writeWithoutResponse: controlPointCharacteristic.properties.writeWithoutResponse,
            notify: controlPointCharacteristic.properties.notify
        }); */

        // Subscribe to control point notifications
        controlPointCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            console.log('controlPointCharacteristic triggered');
            const value = new Uint8Array(event.target.value.buffer);
            console.log('Control point notification:', Array.from(value));
        });
        await controlPointCharacteristic.startNotifications();

        // ** ball data characteristic **

        ballDataCharacteristic = await service.getCharacteristic(ballDataUuid);

        // Subscribe to ball data notifications
        ballDataCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            console.log('ballDataCharacteristic triggered');

            console.log('Ball data value length:', event.target.value.byteLength);
            const value = new Uint8Array(event.target.value.buffer);
            console.log('Ball data value bytes:', Array.from(value));

            //const value = new Uint8Array(event.target.value.buffer);
            const base64 = btoa(String.fromCharCode.apply(null, value));
            dotNetRef.invokeMethodAsync('OnDataReceived', base64);
        });
        await ballDataCharacteristic.startNotifications();

        console.log('Connected to R10 - All characteristics ready');
    } catch (error) {
        console.error('Bluetooth error:', error);

        // Provide specific error messages
        let errorMessage = error.message;
        if (error.message.includes('User cancelled')) {
            errorMessage = 'Anslutning avbruten av användare';
        } else if (error.message.includes('device is already open')) {
            errorMessage = 'R10 är redan ansluten till en annan app. Stäng Garmin Golf appen först.';
        } else if (error.message.includes('GATT Server is disconnected')) {
            errorMessage = 'R10 kopplade från. Kontrollera att enheten är påslagen och i närheten.';
        }

        dotNetRef.invokeMethodAsync('OnError', errorMessage);
        throw error;
    }
}

function handleDeviceDisconnected() {
    console.log('Device disconnected.');
    if (window.dotNetRef) {
        window.dotNetRef.invokeMethodAsync('OnError', 'R10 kopplade från oväntat. Möjligen ansluten till annan app.');
    }
}

export async function startMonitoring() {
    console.log('startMonitoring start');
    if (!controlPointCharacteristic) {
        throw new Error('Control point not connected');
    }

    try {
        const commandInit = new Uint8Array([0x01]);
        console.log(`Writing command: [${Array.from(commandInit)}]`);
        await controlPointCharacteristic.writeValue(commandInit);

        const commandStart = new Uint8Array([0x00]);
        console.log(`Writing command: [${Array.from(commandStart)}]`);
        await controlPointCharacteristic.writeValue(commandStart);

        const commandNotifyEnable = new Uint8Array([0x01, 0x00]);
        console.log(`Writing command: [${Array.from(commandNotifyEnable)}]`);
        await controlPointCharacteristic.writeValue(commandNotifyEnable);

        console.log('Start monitoring command sent successfully');
        
    } catch (error) {
        console.error('Failed to start monitoring:', error);
        throw error;
    }
}

export async function stopMonitoring() {
    console.log('stopMonitoring start');
    if (!controlPointCharacteristic) {
        throw new Error('Control point not connected');
    }

    try {
        // Example: Send a stop command (adjust the command bytes as needed for your device)
        const commandStop = new Uint8Array([0x02]);
        console.log(`Writing stop command: [${Array.from(commandStop)}]`);
        await controlPointCharacteristic.writeValue(commandStop);

        console.log('Stop monitoring command sent successfully');
    } catch (error) {
        console.error('Failed to stop monitoring:', error);
        throw error;
    }
}

export async function disconnect() {
    if (ballDataCharacteristic) {
        try {
            await ballDataCharacteristic.stopNotifications();
        } catch (e) {
            console.error('Error stopping ball data notifications:', e);
        }
    }
    if (statusCharacteristic) {
        try {
            await statusCharacteristic.stopNotifications();
        } catch (e) {
            console.error('Error stopping status notifications:', e);
        }
    }
    if (controlPointCharacteristic) {
        try {
            await controlPointCharacteristic.stopNotifications();
        } catch (e) {
            console.error('Error stopping control point notifications:', e);
        }
    }

    if (device) {
        device.removeEventListener('gattserverdisconnected', handleDeviceDisconnected);
    }

    if (device && device.gatt.connected) {
        device.gatt.disconnect();
    }

    ballDataCharacteristic = null;
    statusCharacteristic = null;
    controlPointCharacteristic = null;
    device = null;
}

// Add this exported helper to your existing module (append or merge with current exports).
// It creates a text blob and triggers a download from the browser.
export function saveTextFile(filename, text) {
    try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('saveTextFile failed', e);
        throw e;
    }
}

// Minimal audio init + beep helpers for Blazor interop.
// Call `initAudio()` from a user gesture (button click) so browsers allow audio.
// `beep()` then uses the unlocked/resumed AudioContext.

export function initAudio() {
    try {
        if (window.__r10_audioctx) {
            // already initialized
            return;
        }

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;

        // Create and try to resume immediately (must be called from user gesture)
        window.__r10_audioctx = new Ctx();
        // Resume may be required on some browsers
        window.__r10_audioctx.resume && window.__r10_audioctx.resume().catch(() => {});
    } catch (e) {
        console.warn('initAudio failed', e);
    }
}

export function beep() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        // Prefer the previously created context so it's not blocked
        const ctx = window.__r10_audioctx || (Ctx ? new Ctx() : null);
        if (!ctx) return;

        // If we created a context now (no user gesture), try to keep it for future
        if (!window.__r10_audioctx) {
            window.__r10_audioctx = ctx;
        }

        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 880; // Hz
        g.gain.value = 0.04; // volume
        o.connect(g);
        g.connect(ctx.destination);

        // Start and stop quickly
        o.start();
        setTimeout(() => {
            try { o.stop(); } catch { /* ignore */ }
        }, 120);
    } catch (e) {
        console.warn('beep failed', e);
    }
}