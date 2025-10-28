/**
 * Polyfills for browser compatibility with XMTP SDK
 * Based on cthulhu-launcher/frontend/src/polyfills.js
 */

import { Buffer } from 'buffer';

// Attach Node-like globals expected by some libraries (including XMTP)
if (typeof window !== 'undefined') {
  interface WindowWithGlobals extends Window {
    global?: typeof globalThis;
    Buffer?: typeof Buffer;
  }
  const win = window as WindowWithGlobals;
  if (!win.global) {
    win.global = window;
  }
  if (!win.Buffer) {
    win.Buffer = Buffer;
  }
}

// Graceful fallback for incorrect WASM Content-Type or proxy issues
if (typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiateStreaming === 'function') {
  const originalInstantiateStreaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = async (sourcePromise, importObject) => {
    try {
      return await originalInstantiateStreaming(sourcePromise, importObject);
    } catch (err) {
      console.warn('[Polyfill] WASM streaming failed, trying direct fetch:', (err as Error).message);
      try {
        const response = await sourcePromise;
        
        // Check if response looks corrupted
        if (!response.ok) {
          throw new Error(`Bad response: ${response.status}`);
        }
        
        const contentLength = response.headers.get('content-length');
        console.log(`[Polyfill] WASM content-length: ${contentLength}`);
        
        const bytes = await response.arrayBuffer();
        console.log(`[Polyfill] WASM actual bytes: ${bytes.byteLength}`);
        
        // Validate WASM magic number
        const view = new Uint8Array(bytes);
        if (view.length < 4 || view[0] !== 0x00 || view[1] !== 0x61 || view[2] !== 0x73 || view[3] !== 0x6d) {
          throw new Error('Invalid WASM magic number - file may be corrupted');
        }
        
        return await WebAssembly.instantiate(bytes, importObject);
      } catch (err2) {
        console.error('[Polyfill] WASM fallback also failed:', err2);
        throw err2 || err;
      }
    }
  };
}

console.log('[Polyfill] Loaded: Buffer, global, WASM fallback');

