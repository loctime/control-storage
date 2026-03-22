const admin = require('../firebaseAdmin');

// APP_CODE eliminado - ya no es necesario

async function getFolderDoc(folderId) {
  if (!folderId) return null;
  const ref = admin.firestore().collection('files').doc(folderId);
  const snap = await ref.get();
  return snap.exists ? { id: ref.id, data: snap.data() } : null;
}

// Función eliminada - ya no necesitamos carpetas raíz por app

async function resolveParentAndAncestors(uid, parentId) {
  if (parentId) {
    const parent = await getFolderDoc(parentId);
    if (!parent) {
      console.warn(`⚠️ Carpeta padre no encontrada: ${parentId}, usando raíz`);
      return {
        parentId: null,
        path: '',
        ancestors: [],
      };
    }
    const parentAncestors = Array.isArray(parent.data.ancestors) ? parent.data.ancestors : [];
    return {
      parentId,
      path: parent.data.path || '',
      ancestors: [...parentAncestors, parentId],
    };
  }

  // Siempre usar raíz clásica (parentId null)
  return {
    parentId: null,
    path: '',
    ancestors: [],
  };
}

// Función eliminada - ya no necesitamos filtrar por app

module.exports = {
  getFolderDoc,
  resolveParentAndAncestors,
};


