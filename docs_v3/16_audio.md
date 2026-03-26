# ControlFile – Audio

---

## Overview

The audio domain provides server-side audio mastering. An existing audio file in `files` is downloaded from B2, processed (mastered), and uploaded back — either as a new file or replacing the original.

**Prefix:** `/api/audio/`, `/v1/audio/`

---

## Endpoint

### POST /api/audio/master

Master an audio file. Downloads from B2, processes with FFmpeg, uploads result back to B2.

**Auth:** Required (Firebase ID Token)
**Backend:** `POST /v1/audio/master`

**Request:**
```json
{
  "fileId": "firestoreDocId",
  "action": "create"
}
```

| Field | Required | Values | Description |
|---|---|---|---|
| `fileId` | Yes | — | Firestore `files` doc ID of the audio file to master |
| `action` | Yes | `"create"` \| `"replace"` | `"create"` = new file; `"replace"` = overwrite same `bucketKey` |

**Validations:**
- File must exist in `files` collection
- Ownership check (`userId == uid`)
- File must not be soft-deleted (`deletedAt == null`)
- File must be a valid audio MIME type (mp3, wav, aac, ogg, flac, m4a, etc.)

**Response `200`:**
```json
{
  "success": true,
  "fileId": "newOrSameFirestoreDocId",
  "name": "audio_mastered.mp3",
  "size": 2048576,
  "mime": "audio/mpeg"
}
```

**Errors:**

| Status | Description |
|---|---|
| `400` | Missing `fileId`, invalid `action`, invalid audio format, or file is deleted |
| `401` | Missing or invalid Firebase token |
| `403` | File does not belong to caller |
| `404` | File not found |
| `500` | B2 download error, mastering error, or upload error |

---

## Processing

The mastering pipeline:

1. Download source audio buffer from B2 via `bucketKey`
2. Determine input/output format pair from MIME type
3. Process with FFmpeg (server-side audio processing)
4. Upload mastered output to B2

For `action: "create"`: uploads to a new `bucketKey`, creates a new `files/{id}` document

For `action: "replace"`: uploads to the **same `bucketKey`** (overwrites), updates existing `files/{id}` with new size, mime, etag

---

## Supported Audio Formats

Supported by the MIME type validator:

| MIME | Format |
|---|---|
| `audio/mpeg` | MP3 |
| `audio/wav` | WAV |
| `audio/aac` | AAC |
| `audio/ogg` | OGG |
| `audio/flac` | FLAC |
| `audio/mp4` | M4A |
| `audio/x-m4a` | M4A (alternate) |

Non-audio MIME types return `400`.
