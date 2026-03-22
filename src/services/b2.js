const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Initialize S3 client for Backblaze B2
const B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
const REGION_FROM_ENDPOINT = (() => {
  try {
    const match = B2_ENDPOINT.match(/s3\.([a-z0-9\-]+)\.backblazeb2\.com/i);
    return match ? match[1] : 'us-east-005';
  } catch (_) {
    return 'us-east-005';
  }
})();

const s3Client = new S3Client({
  region: REGION_FROM_ENDPOINT,
  endpoint: B2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APPLICATION_KEY,
  },
  forcePathStyle: true,
});

const BUCKET_NAME = process.env.B2_BUCKET_NAME;
const MULTIPART_THRESHOLD = 128 * 1024 * 1024; // 128MB

// Log B2 configuration
console.log('🔧 B2 Configuration:', {
  endpoint: B2_ENDPOINT,
  region: REGION_FROM_ENDPOINT,
  bucketName: BUCKET_NAME,
  keyId: process.env.B2_KEY_ID ? 'CONFIGURADO' : 'NO CONFIGURADO',
  applicationKey: process.env.B2_APPLICATION_KEY ? 'CONFIGURADO' : 'NO CONFIGURADO'
});

// Generate presigned URL for upload
async function createPresignedPutUrl(key, expiresIn = 3600, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

// Generate presigned URL for download
async function createPresignedGetUrl(key, expiresIn = 300) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

// Delete object from B2
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

// Get object metadata
async function getObjectMetadata(key) {
  const command = new HeadObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  try {
    const response = await s3Client.send(command);
    return {
      size: response.ContentLength || 0,
      etag: response.ETag?.replace(/"/g, '') || '',
      lastModified: response.LastModified,
      contentType: response.ContentType,
    };
  } catch (error) {
    if (error.name === 'NotFound') {
      return null;
    }
    throw error;
  }
}

// Multipart upload utilities
async function createMultipartUpload(key, contentType) {
  const command = new CreateMultipartUploadCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  const response = await s3Client.send(command);
  if (!response.UploadId) {
    throw new Error('Failed to create multipart upload');
  }

  return response.UploadId;
}

async function createPresignedUploadPartUrl(key, uploadId, partNumber, expiresIn = 3600) {
  const command = new UploadPartCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

async function completeMultipartUpload(key, uploadId, parts) {
  const command = new CompleteMultipartUploadCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  });

  await s3Client.send(command);
}

async function abortMultipartUpload(key, uploadId) {
  const command = new AbortMultipartUploadCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
  });

  await s3Client.send(command);
}

// Calculate multipart upload configuration
function calculateMultipartConfig(fileSize) {
  if (fileSize < MULTIPART_THRESHOLD) {
    return null; // Use regular upload
  }

  const maxParts = 10000; // B2 limit
  const minPartSize = 5 * 1024 * 1024; // 5MB minimum
  const maxPartSize = 5 * 1024 * 1024 * 1024; // 5GB maximum

  let partSize = Math.ceil(fileSize / maxParts);
  partSize = Math.max(partSize, minPartSize);
  partSize = Math.min(partSize, maxPartSize);

  const totalParts = Math.ceil(fileSize / partSize);

  return {
    partSize,
    totalParts,
    useMultipart: true,
  };
}

// List objects with prefix (for reconciliation)
async function listObjects(prefix, maxKeys = 1000) {
  const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
  
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
    MaxKeys: maxKeys,
  });

  const response = await s3Client.send(command);
  return {
    objects: response.Contents || [],
    isTruncated: response.IsTruncated || false,
    continuationToken: response.NextContinuationToken,
  };
}

// Upload file directly from backend to B2
async function uploadFileDirectly(key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  const response = await s3Client.send(command);
  
  return {
    etag: response.ETag?.replace(/"/g, '') || '',
    versionId: response.VersionId,
  };
}

// Get object as buffer (for virus scan, OCR, etc)
async function getObjectBuffer(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);
  
  // Convert stream to buffer
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  
  return Buffer.concat(chunks);
}

// Get object as stream (for proxying files with CORS)
async function getObjectStream(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);
  
  // Return the stream directly (response.Body is a Readable stream)
  return response.Body;
}

module.exports = {
  createPresignedPutUrl,
  createPresignedGetUrl,
  deleteObject,
  getObjectMetadata,
  createMultipartUpload,
  createPresignedUploadPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  calculateMultipartConfig,
  listObjects,
  uploadFileDirectly,
  getObjectBuffer,
  getObjectStream,
};
