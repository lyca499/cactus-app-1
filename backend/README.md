# Cactus Memory Backend

This is a **React Native backend** that uses Cactus SDK directly! 🎉

## Why React Native Backend?

Since Cactus SDK only supports React Native/Flutter/Kotlin (not Node.js), this backend is built as a React Native app to use Cactus SDK directly:

```typescript
import { CactusLM } from 'cactus-react-native'; // ✅ Works!

const cactusLM = new CactusLM({ model: 'qwen3-0.6' });
await cactusLM.download();
await cactusLM.init();
```

## Features

✅ **Uses actual Cactus SDK** - No workarounds needed!  
✅ **Automatic image scanning** - Frontend can scan photo library and send images automatically  
✅ **Batch processing** - Process multiple images at once  
✅ **Local inference** - All processing happens on device  
✅ **Router pattern** - Local/cloud decision logic  
✅ **Vector search** - Memory retrieval with embeddings  
✅ **HTTP API** - RESTful endpoints for frontend integration  

## Quick Start

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Run on device/simulator:**
   ```bash
   # iOS
   npm run ios
   
   # Android
   npm run android
   ```

## Architecture

```
React Native Backend App
    ↓
HTTP Server (react-native-tcp-socket)
    ↓
Receives images from frontend's automatic photo scanning
    ↓
Uses Cactus SDK directly:
  - CactusLM for text generation
  - CactusLM (vision) for OCR
  - CactusLM.embed() for embeddings
    ↓
InferenceRouter (local/cloud routing)
    ↓
MemoryDatabase (AsyncStorage)
```

## API Endpoints

### `POST /api/process-image`

Process a single image (for automatic scanning).

**Request:**
```json
{
  "imagePath": "/path/to/image.jpg",
  // OR
  "imageUri": "file:///path/to/image.jpg"
}
```

**Response:**
```json
{
  "success": true,
  "memoryId": 1,
  "extractedText": "...",
  "summary": "...",
  "classification": "email",
  "embedding": [0.123, ...],
  "confidenceScore": 0.85,
  "inferenceMode": "local"
}
```

### `POST /api/process-images-batch`

Process multiple images at once (for batch scanning).

**Request:**
```json
{
  "images": [
    { "imagePath": "/path/to/image1.jpg" },
    { "imagePath": "/path/to/image2.jpg" },
    { "imageUri": "file:///path/to/image3.jpg" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "processed": 2,
  "failed": 1,
  "total": 3,
  "results": [
    { "index": 0, "success": true, "memoryId": 1, ... },
    { "index": 1, "success": true, "memoryId": 2, ... }
  ],
  "errors": [
    { "index": 2, "error": "File not found" }
  ]
}
```

### `POST /api/query-memory`

Query memory with vector search (for chat interface).

**Request:**
```json
{
  "query": "What emails did I receive?",
  "maxResults": 5
}
```

**Response:**
```json
{
  "answer": "...",
  "relevantMemories": [
    {
      "id": 1,
      "summary": "...",
      "classification": "email",
      "similarity": 0.89
    }
  ]
}
```

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "Cactus Memory Backend"
}
```

## Frontend Integration

### Automatic Photo Library Scanning

The backend is designed to work with a frontend that automatically scans the user's photo library:

```typescript
// Frontend example (React Native)
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// After user grants permission
const photos = await CameraRoll.getPhotos({
  first: 1000, // Get all photos
  assetType: 'Photos',
});

// Send images to backend automatically
for (const photo of photos.edges) {
  await fetch('http://localhost:3000/api/process-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUri: photo.node.image.uri,
    }),
  });
}
```

### Batch Processing

For better performance, send multiple images at once:

```typescript
const images = photos.edges.map(edge => ({
  imageUri: edge.node.image.uri,
}));

await fetch('http://localhost:3000/api/process-images-batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ images }),
});
```

## Key Files

- `src/server/server-simple.ts` - Core server logic (uses Cactus SDK)
- `src/server/httpServer.ts` - HTTP server implementation
- `src/services/InferenceRouter.ts` - Uses Cactus SDK for inference
- `src/database/MemoryDatabase.ts` - Stores memories in AsyncStorage
- `src/App.tsx` - React Native UI that shows server status

## Notes

- The backend runs on the device/simulator
- All inference happens locally using Cactus SDK
- No Node.js required - pure React Native!
- Uses AsyncStorage for persistence
- HTTP server listens on `0.0.0.0:3000` (accessible from other devices on the same network)

## See Also

- [API.md](./API.md) - Complete API documentation
