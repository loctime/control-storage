const express = require('express');
const router = express.Router();
const admin = require('../../firebaseAdmin');
const {
  getTokensFromAuthCode,
  getSheetsClient,
  getDriveClient,
  getSheetsServiceClient,
  checkSheetPermissions,
  shareSheetWithServiceAccount,
  createProductSheet,
  readProductsFromSheet,
  createSheetBackup
} = require('../../utils/googleAuth');

// Cache simple en memoria (en producción usar Redis)
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutos

// Función para obtener datos de la tienda
async function getStoreData(storeId) {
  try {
    const db = admin.firestore();
    const storeRef = db.collection('stores').doc(storeId);
    const storeDoc = await storeRef.get();
    
    if (!storeDoc.exists) {
      throw new Error('Store not found');
    }
    
    return storeDoc.data();
  } catch (error) {
    console.error('Error getting store data:', error);
    throw error;
  }
}

// Función para actualizar datos de la tienda
async function updateStoreData(storeId, data) {
  try {
    const db = admin.firestore();
    const storeRef = db.collection('stores').doc(storeId);
    await storeRef.update(data);
  } catch (error) {
    console.error('Error updating store data:', error);
    throw error;
  }
}

// Función para guardar productos en Firestore
async function saveProductsToFirestore(storeId, products) {
  try {
    const db = admin.firestore();
    const batch = db.batch();
    
    // Eliminar productos existentes
    const existingProducts = await db.collection('stores').doc(storeId).collection('products').get();
    existingProducts.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Agregar nuevos productos
    products.forEach(product => {
      const productRef = db.collection('stores').doc(storeId).collection('products').doc(product.id);
      batch.set(productRef, {
        ...product,
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    
    await batch.commit();
    return products.length;
  } catch (error) {
    console.error('Error saving products to Firestore:', error);
    throw error;
  }
}

// POST /api/stores/:storeId/sheets/create
router.post('/:storeId/sheets/create', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { authCode } = req.body;
    
    if (!authCode) {
      return res.status(400).json({
        error: 'Authorization code is required',
        code: 'AUTH_CODE_MISSING'
      });
    }

    // Obtener datos de la tienda
    const storeData = await getStoreData(storeId);
    
    // Obtener tokens de OAuth2
    const tokens = await getTokensFromAuthCode(authCode);
    
    // Crear cliente OAuth2
    const oauth2Client = new (require('googleapis').google.auth.OAuth2)(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'postmessage'
    );
    oauth2Client.setCredentials(tokens);
    
    // Crear hoja de productos
    const sheetResult = await createProductSheet(oauth2Client, storeData.name || storeId);
    
    // Compartir con service account
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const shared = await shareSheetWithServiceAccount(sheetResult.spreadsheetId, serviceAccountEmail);
    
    if (!shared) {
      console.warn('Failed to share sheet with service account');
    }
    
    // Guardar información de la hoja en la tienda
    await updateStoreData(storeId, {
      googleSheet: {
        spreadsheetId: sheetResult.spreadsheetId,
        sheetId: sheetResult.sheetId,
        editUrl: sheetResult.editUrl,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncAt: null
      }
    });
    
    // Limpiar caché
    cache.delete(`products_${storeId}`);
    
    res.json({
      success: true,
      sheetId: sheetResult.spreadsheetId,
      editUrl: sheetResult.editUrl
    });
    
  } catch (error) {
    console.error('Error creating sheet:', error);
    
    if (error.message === 'Store not found') {
      return res.status(404).json({
        error: 'Store not found',
        code: 'STORE_NOT_FOUND'
      });
    }
    
    if (error.message === 'Invalid authorization code') {
      return res.status(400).json({
        error: 'Invalid authorization code',
        code: 'INVALID_AUTH_CODE'
      });
    }
    
    res.status(500).json({
      error: 'Failed to create sheet',
      code: 'SHEET_CREATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/stores/:storeId/products
router.get('/:storeId/products', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { forceRefresh } = req.query;
    
    // Verificar caché
    const cacheKey = `products_${storeId}`;
    if (!forceRefresh && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json({
          ...cached.data,
          cached: true
        });
      }
    }
    
    // Obtener datos de la tienda
    const storeData = await getStoreData(storeId);
    
    if (!storeData.googleSheet || !storeData.googleSheet.spreadsheetId) {
      return res.status(404).json({
        error: 'No Google Sheet configured for this store',
        code: 'NO_SHEET_CONFIGURED'
      });
    }
    
    // Leer productos de la hoja
    const { products, categories } = await readProductsFromSheet(storeData.googleSheet.spreadsheetId);
    
    // Guardar en caché
    const result = { products, categories };
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
    
    res.json({
      ...result,
      cached: false
    });
    
  } catch (error) {
    console.error('Error getting products:', error);
    
    if (error.message === 'Store not found') {
      return res.status(404).json({
        error: 'Store not found',
        code: 'STORE_NOT_FOUND'
      });
    }
    
    if (error.code === 403) {
      return res.status(403).json({
        error: 'No permission to access Google Sheet',
        code: 'SHEET_ACCESS_DENIED'
      });
    }
    
    if (error.code === 404) {
      return res.status(404).json({
        error: 'Google Sheet not found',
        code: 'SHEET_NOT_FOUND'
      });
    }
    
    res.status(500).json({
      error: 'Failed to get products',
      code: 'PRODUCTS_FETCH_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/stores/:storeId/sheets/sync
router.post('/:storeId/sheets/sync', async (req, res) => {
  try {
    const { storeId } = req.params;
    
    // Obtener datos de la tienda
    const storeData = await getStoreData(storeId);
    
    if (!storeData.googleSheet || !storeData.googleSheet.spreadsheetId) {
      return res.status(404).json({
        error: 'No Google Sheet configured for this store',
        code: 'NO_SHEET_CONFIGURED'
      });
    }
    
    // Leer productos de la hoja (ignorar caché)
    const { products, categories } = await readProductsFromSheet(storeData.googleSheet.spreadsheetId);
    
    // Guardar productos en Firestore
    const count = await saveProductsToFirestore(storeId, products);
    
    // Actualizar timestamp de sincronización
    await updateStoreData(storeId, {
      'googleSheet.lastSyncAt': admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Limpiar caché
    cache.delete(`products_${storeId}`);
    
    res.json({
      success: true,
      count,
      products: products.length,
      categories: categories.length
    });
    
  } catch (error) {
    console.error('Error syncing products:', error);
    
    if (error.message === 'Store not found') {
      return res.status(404).json({
        error: 'Store not found',
        code: 'STORE_NOT_FOUND'
      });
    }
    
    if (error.code === 403) {
      return res.status(403).json({
        error: 'No permission to access Google Sheet',
        code: 'SHEET_ACCESS_DENIED'
      });
    }
    
    if (error.code === 404) {
      return res.status(404).json({
        error: 'Google Sheet not found',
        code: 'SHEET_NOT_FOUND'
      });
    }
    
    res.status(500).json({
      error: 'Failed to sync products',
      code: 'SYNC_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/stores/:storeId/backup
router.post('/:storeId/backup', async (req, res) => {
  try {
    const { storeId } = req.params;
    
    // Obtener datos de la tienda
    const storeData = await getStoreData(storeId);
    
    if (!storeData.googleSheet || !storeData.googleSheet.spreadsheetId) {
      return res.status(404).json({
        error: 'No Google Sheet configured for this store',
        code: 'NO_SHEET_CONFIGURED'
      });
    }
    
    // Crear backup
    const backupResult = await createSheetBackup(
      storeData.googleSheet.spreadsheetId,
      storeData.name || storeId
    );
    
    // Guardar información del backup
    await updateStoreData(storeId, {
      'googleSheet.lastBackupAt': admin.firestore.FieldValue.serverTimestamp(),
      'googleSheet.lastBackupUrl': backupResult.backupUrl
    });
    
    res.json({
      success: true,
      backupUrl: backupResult.backupUrl
    });
    
  } catch (error) {
    console.error('Error creating backup:', error);
    
    if (error.message === 'Store not found') {
      return res.status(404).json({
        error: 'Store not found',
        code: 'STORE_NOT_FOUND'
      });
    }
    
    if (error.code === 403) {
      return res.status(403).json({
        error: 'No permission to access Google Sheet',
        code: 'SHEET_ACCESS_DENIED'
      });
    }
    
    if (error.code === 404) {
      return res.status(404).json({
        error: 'Google Sheet not found',
        code: 'SHEET_NOT_FOUND'
      });
    }
    
    res.status(500).json({
      error: 'Failed to create backup',
      code: 'BACKUP_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
