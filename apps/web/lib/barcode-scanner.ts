type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
};

type SerialLike = {
  requestPort: () => Promise<SerialPortLike>;
  getPorts: () => Promise<SerialPortLike[]>;
};

export type ScannerSession = {
  close: () => Promise<void>;
};

const SCANNER_BAUD_RATE = 9600;

function scannerSerial(): SerialLike | null {
  if (typeof navigator === "undefined" || !("serial" in navigator)) return null;
  return navigator.serial as SerialLike;
}

export function serialScannerAvailable(): boolean {
  return scannerSerial() !== null;
}

async function readPort(port: SerialPortLike, onCode: (code: string) => void): Promise<ScannerSession> {
  await port.open({ baudRate: SCANNER_BAUD_RATE });
  const readable = port.readable;
  if (!readable) {
    await port.close().catch(() => undefined);
    throw new Error("The barcode scanner did not open.");
  }
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stopped = false;
  const pump = (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r\n|\n|\r/);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const code = part.trim();
          if (code) onCode(code);
        }
      }
    } catch {
      // Closing the port cancels the read.
    } finally {
      reader.releaseLock();
    }
  })();
  return {
    async close() {
      stopped = true;
      await reader.cancel().catch(() => undefined);
      await pump.catch(() => undefined);
      await port.close().catch(() => undefined);
    },
  };
}

/** Reopen a scanner the browser was already allowed to use. */
export async function openGrantedScanner(onCode: (code: string) => void): Promise<ScannerSession | null> {
  const serial = scannerSerial();
  if (!serial) return null;
  const [port] = await serial.getPorts();
  if (!port) return null;
  return readPort(port, onCode);
}

/** Ask the cashier to pick a serial barcode scanner, then read payment codes from it. */
export async function requestScanner(onCode: (code: string) => void): Promise<ScannerSession> {
  const serial = scannerSerial();
  if (!serial) throw new Error("This browser cannot open a barcode scanner.");
  const port = await serial.requestPort();
  return readPort(port, onCode);
}
