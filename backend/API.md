# API Documentation

## Base URL

```
http://localhost:3000
```

For physical devices, use the device's IP address:
```
http://192.168.1.100:3000
```

## Endpoints

### Health Check

**GET** `/health`

Check if the server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "Cactus Memory Backend"
}
```

---

### Process Single Image

**POST** `/api/process-image`

Process a single image from the frontend's automatic photo library scanning.

**Request Body:**
```json
{
  "imagePath": "/path/to/image.jpg",
  // OR
  "imageUri": "file:///path/to/image.jpg"
  // OR (future)
  "base64Image": "data:image/jpeg;base64,..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "memoryId": 1,
  "extractedText": "Text extracted from image...",
  "summary": "Summary of the content...",
  "classification": "email",
  "embedding": [0.123, 0.456, ...],
  "confidenceScore": 0.85,
  "inferenceMode": "local"
}
```

**Error Responses:**

- `400 Bad Request`: Missing or invalid image path/URI
- `500 Internal Server Error`: Processing failed

---

### Process Multiple Images (Batch)

**POST** `/api/process-images-batch`

Process multiple images at once. Useful when the frontend scans the entire photo library.

**Request Body:**
```json
{
  "images": [
    { "imagePath": "/path/to/image1.jpg" },
    { "imageUri": "file:///path/to/image2.jpg" },
    { "imagePath": "/path/to/image3.jpg" }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "processed": 2,
  "failed": 1,
  "total": 3,
  "results": [
    {
      "index": 0,
      "success": true,
      "memoryId": 1,
      "extractedText": "...",
      "summary": "...",
      "classification": "email",
      "embedding": [...],
      "confidenceScore": 0.85,
      "inferenceMode": "local"
    },
    {
      "index": 1,
      "success": true,
      "memoryId": 2,
      ...
    }
  ],
  "errors": [
    {
      "index": 2,
      "imagePath": "/path/to/image3.jpg",
      "error": "File not found"
    }
  ]
}
```

**Notes:**
- Images are processed sequentially to avoid overwhelming the device
- Failed images are included in the `errors` array
- Each result includes the original `index` from the request

---

### Query Memory

**POST** `/api/query-memory`

Query stored memories using vector similarity search. Used by the chat interface.

**Request Body:**
```json
{
  "query": "What emails did I receive?",
  "maxResults": 5
}
```

**Response (200 OK):**
```json
{
  "answer": "Based on your memories, you received emails about...",
  "relevantMemories": [
    {
      "id": 1,
      "screenshot_path": "/path/to/image.jpg",
      "extracted_text": "...",
      "summary": "Email about project update",
      "classification": "email",
      "embedding": [...],
      "confidence_score": 0.85,
      "inference_mode": "local",
      "created_at": "2024-01-01T00:00:00.000Z",
      "similarity": 0.89
    }
  ]
}
```

**Error Responses:**

- `400 Bad Request`: Missing or invalid query
- `500 Internal Server Error`: Query failed

---

## Frontend Integration Example

### Automatic Photo Library Scanning

```typescript
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

// 1. Request permission
const permission = await CameraRoll.requestPhotosPermissions();

if (permission === 'granted') {
  // 2. Get all photos
  const photos = await CameraRoll.getPhotos({
    first: 1000,
    assetType: 'Photos',
  });

  // 3. Process images in batches
  const batchSize = 10;
  const images = photos.edges.map(edge => ({
    imageUri: edge.node.image.uri,
  }));

  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    
    const response = await fetch('http://localhost:3000/api/process-images-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: batch }),
    });

    const result = await response.json();
    console.log(`Processed ${result.processed}/${result.total} images`);
  }
}
```

### Query Memory for Chat

```typescript
const response = await fetch('http://localhost:3000/api/query-memory', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'What did I screenshot yesterday?',
    maxResults: 5,
  }),
});

const result = await response.json();
console.log('Answer:', result.answer);
console.log('Relevant memories:', result.relevantMemories);
```

---

## CORS

The server includes CORS headers to allow requests from the frontend:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "error": "Error Type",
  "message": "Detailed error message"
}
```

Common error codes:
- `400`: Bad Request (invalid input)
- `404`: Not Found (invalid endpoint)
- `500`: Internal Server Error (processing failed)

