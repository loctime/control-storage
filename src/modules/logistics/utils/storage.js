const admin = require("../../../firebaseAdmin");
const b2Service = require("../../../services/b2");

function getDocumentFilesCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("document_files");
}

function buildStoragePath({ ownerId, branchId, documentType, documentId, fileType, extension }) {
  const ext = extension ? `.${extension.replace(/^\./, "")}` : "";
  return `logistics/${ownerId}/${branchId}/${documentType}/${documentId}/${fileType}-${Date.now()}${ext}`;
}

async function uploadAndRegisterDocumentFile({ ownerId, branchId, documentType, documentId, fileType, buffer, mimeType, extension, metadata, createdBy }) {
  const ref = getDocumentFilesCollection().doc();
  const storagePath = buildStoragePath({ ownerId, branchId, documentType, documentId, fileType, extension });
  const upload = await b2Service.uploadFileDirectly(storagePath, buffer, mimeType || "application/octet-stream");

  const data = {
    id: ref.id,
    ownerId,
    branchId,
    documentType,
    documentId,
    fileType,
    storagePath,
    checksum: upload.etag || null,
    metadata: metadata || {},
    createdAt: new Date(),
    createdBy,
  };

  await ref.set(data);
  return data;
}

module.exports = {
  uploadAndRegisterDocumentFile,
  buildStoragePath,
};
