/**
 * HTTP Server for React Native Backend
 * 
 * Uses react-native-tcp-socket to create an HTTP server that can receive
 * images from the frontend's automatic photo library scanning.
 */

// Note: We'll import these functions dynamically to avoid circular dependency
// import { processScreenshot, queryMemory } from './server-simple';

interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

let serverSocket: Socket | null = null;
let isServerRunning = false;

/**
 * Parse HTTP request from raw data
 */
function parseHttpRequest(data: string): HttpRequest | null {
  const lines = data.split('\r\n');
  if (lines.length === 0) return null;

  // Parse request line
  const requestLine = lines[0].split(' ');
  if (requestLine.length < 2) return null;

  const method = requestLine[0];
  const path = requestLine[1];

  // Parse headers
  const headers: Record<string, string> = {};
  let bodyStartIndex = 1;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') {
      bodyStartIndex = i + 1;
      break;
    }
    const colonIndex = lines[i].indexOf(':');
    if (colonIndex > 0) {
      const key = lines[i].substring(0, colonIndex).trim().toLowerCase();
      const value = lines[i].substring(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  // Parse body
  const body = lines.slice(bodyStartIndex).join('\r\n');

  return { method, path, headers, body };
}

/**
 * Create HTTP response
 */
function createHttpResponse(
  statusCode: number,
  body: any,
  contentType: string = 'application/json'
): string {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = {
    'Content-Type': contentType,
    'Content-Length': bodyStr.length.toString(),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const headersStr = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');

  return `HTTP/1.1 ${statusCode} ${getStatusText(statusCode)}\r\n${headersStr}\r\n\r\n${bodyStr}`;
}

function getStatusText(statusCode: number): string {
  const statusTexts: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    400: 'Bad Request',
    404: 'Not Found',
    500: 'Internal Server Error',
  };
  return statusTexts[statusCode] || 'Unknown';
}

/**
 * Handle incoming HTTP request
 */
async function handleRequest(socket: Socket, request: HttpRequest): Promise<void> {
  try {
    const { method, path, body } = request;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      socket.write(createHttpResponse(200, ''));
      socket.end();
      return;
    }

    // Route requests
    if (path === '/health' && method === 'GET') {
      socket.write(
        createHttpResponse(200, {
          status: 'ok',
          timestamp: new Date().toISOString(),
          service: 'Cactus Memory Backend',
        })
      );
      socket.end();
      return;
    }

    if (path === '/api/process-image' && method === 'POST') {
      await handleProcessImage(socket, body);
      return;
    }

    if (path === '/api/process-images-batch' && method === 'POST') {
      await handleProcessImagesBatch(socket, body);
      return;
    }

    if (path === '/api/query-memory' && method === 'POST') {
      await handleQueryMemory(socket, body);
      return;
    }

    // 404 Not Found
    socket.write(
      createHttpResponse(404, {
        error: 'Not Found',
        message: `Route ${method} ${path} not found`,
      })
    );
    socket.end();
  } catch (error) {
    console.error('[HTTP Server] Error handling request:', error);
    socket.write(
      createHttpResponse(500, {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    );
    socket.end();
  }
}

/**
 * Handle single image processing (for automatic scanning)
 */
async function handleProcessImage(socket: Socket, body: string): Promise<void> {
  try {
    const data = JSON.parse(body);
    const { imagePath, imageUri, base64Image } = data;

    // Support multiple formats:
    // - imagePath: file path on device
    // - imageUri: URI (file:// or content://)
    // - base64Image: base64 encoded image (would need to save to temp file first)
    
    let finalImagePath: string;
    
    if (imagePath) {
      finalImagePath = imagePath;
    } else if (imageUri) {
      finalImagePath = imageUri;
    } else if (base64Image) {
      // For base64, we'd need to save it to a temp file first
      // For now, return error - frontend should send imagePath or imageUri
      socket.write(
        createHttpResponse(400, {
          error: 'Invalid Request',
          message: 'Please provide imagePath or imageUri. Base64 images not yet supported.',
        })
      );
      socket.end();
      return;
    } else {
      socket.write(
        createHttpResponse(400, {
          error: 'Invalid Request',
          message: 'Missing imagePath, imageUri, or base64Image',
        })
      );
      socket.end();
      return;
    }

    console.log(`[HTTP Server] Processing image: ${finalImagePath}`);

    // Process the image (dynamic import to avoid circular dependency)
    const { processScreenshot } = await import('./server-simple');
    const result = await processScreenshot(finalImagePath);

    socket.write(createHttpResponse(200, result));
    socket.end();
  } catch (error) {
    console.error('[HTTP Server] Error processing image:', error);
    socket.write(
      createHttpResponse(500, {
        error: 'Processing Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    );
    socket.end();
  }
}

/**
 * Handle batch image processing (for automatic scanning of multiple images)
 */
async function handleProcessImagesBatch(socket: Socket, body: string): Promise<void> {
  try {
    const data = JSON.parse(body);
    const { images } = data;

    if (!Array.isArray(images) || images.length === 0) {
      socket.write(
        createHttpResponse(400, {
          error: 'Invalid Request',
          message: 'images must be a non-empty array',
        })
      );
      socket.end();
      return;
    }

    console.log(`[HTTP Server] Processing batch of ${images.length} images`);

    // Process images sequentially (to avoid overwhelming the device)
    // In production, you might want to process in parallel with a concurrency limit
    const results = [];
    const errors = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const { imagePath, imageUri } = image;

      const finalImagePath = imagePath || imageUri;

      if (!finalImagePath) {
        errors.push({
          index: i,
          error: 'Missing imagePath or imageUri',
        });
        continue;
      }

      try {
        console.log(`[HTTP Server] Processing image ${i + 1}/${images.length}: ${finalImagePath}`);
        const { processScreenshot } = await import('./server-simple');
        const result = await processScreenshot(finalImagePath);
        results.push({
          index: i,
          success: true,
          ...result,
        });
      } catch (error) {
        console.error(`[HTTP Server] Error processing image ${i + 1}:`, error);
        errors.push({
          index: i,
          imagePath: finalImagePath,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    socket.write(
      createHttpResponse(200, {
        success: true,
        processed: results.length,
        failed: errors.length,
        total: images.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      })
    );
    socket.end();
  } catch (error) {
    console.error('[HTTP Server] Error processing batch:', error);
    socket.write(
      createHttpResponse(500, {
        error: 'Batch Processing Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    );
    socket.end();
  }
}

/**
 * Handle memory query (for chat interface)
 */
async function handleQueryMemory(socket: Socket, body: string): Promise<void> {
  try {
    const data = JSON.parse(body);
    const { query, maxResults = 5 } = data;

    if (!query || typeof query !== 'string') {
      socket.write(
        createHttpResponse(400, {
          error: 'Invalid Request',
          message: 'query is required and must be a string',
        })
      );
      socket.end();
      return;
    }

    console.log(`[HTTP Server] Querying memory: "${query}"`);

    const { queryMemory } = await import('./server-simple');
    const result = await queryMemory(query, maxResults);

    socket.write(createHttpResponse(200, result));
    socket.end();
  } catch (error) {
    console.error('[HTTP Server] Error querying memory:', error);
    socket.write(
      createHttpResponse(500, {
        error: 'Query Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    );
    socket.end();
  }
}

/**
 * Start HTTP server
 */
export async function startHttpServer(port: number = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Dynamic import to handle case where module might not be available
      let createServer: any;
      try {
        const tcpSocket = require('react-native-tcp-socket');
        // react-native-tcp-socket exports createServer directly
        createServer = tcpSocket.createServer || tcpSocket.default?.createServer || tcpSocket;
      } catch (e) {
        reject(new Error('react-native-tcp-socket not available. Please install it: npm install react-native-tcp-socket'));
        return;
      }

      if (!createServer) {
        reject(new Error('createServer not found in react-native-tcp-socket'));
        return;
      }

      serverSocket = createServer((socket: any) => {
        let requestData = '';

        socket.on('data', (data: Buffer) => {
          requestData += data.toString('utf8');

          // Check if we have a complete HTTP request
          if (requestData.includes('\r\n\r\n')) {
            const request = parseHttpRequest(requestData);
            if (request) {
              handleRequest(socket, request);
              requestData = ''; // Reset for next request
            }
          }
        });

        socket.on('error', (error: Error) => {
          console.error('[HTTP Server] Socket error:', error);
        });

        socket.on('close', () => {
          // Connection closed
        });
      });

      serverSocket.listen(port, '0.0.0.0', () => {
        isServerRunning = true;
        const url = `http://localhost:${port}`;
        console.log(`[HTTP Server] 🚀 Server listening on ${url}`);
        console.log(`[HTTP Server] Ready to receive images from frontend!`);
        resolve(url);
      });

      serverSocket.on('error', (error: Error) => {
        console.error('[HTTP Server] Server error:', error);
        reject(error);
      });
    } catch (error) {
      console.error('[HTTP Server] Failed to start:', error);
      reject(error);
    }
  });
}

/**
 * Stop HTTP server
 */
export function stopHttpServer(): void {
  if (serverSocket) {
    serverSocket.close();
    serverSocket = null;
    isServerRunning = false;
    console.log('[HTTP Server] Server stopped');
  }
}

/**
 * Check if server is running
 */
export function isHttpServerRunning(): boolean {
  return isServerRunning;
}

