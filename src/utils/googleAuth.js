const { google } = require('googleapis');

// Configuración de OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage' // Para authCode de popup
);

// Service Account para operaciones server-to-server
let serviceAccountAuth = null;

function getServiceAccountAuth() {
  if (!serviceAccountAuth) {
    try {
      const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      serviceAccountAuth = new google.auth.GoogleAuth({
        credentials: serviceAccountKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.file'
        ]
      });
    } catch (error) {
      console.error('Error parsing GOOGLE_SERVICE_ACCOUNT_KEY:', error);
      throw new Error('Invalid service account configuration');
    }
  }
  return serviceAccountAuth;
}

// Obtener tokens de OAuth2 desde authCode
async function getTokensFromAuthCode(authCode) {
  try {
    const { tokens } = await oauth2Client.getToken(authCode);
    oauth2Client.setCredentials(tokens);
    return tokens;
  } catch (error) {
    console.error('Error getting tokens from auth code:', error);
    throw new Error('Invalid authorization code');
  }
}

// Crear cliente de Sheets con OAuth2
function getSheetsClient(auth) {
  return google.sheets({ version: 'v4', auth });
}

// Crear cliente de Drive con OAuth2
function getDriveClient(auth) {
  return google.drive({ version: 'v3', auth });
}

// Crear cliente de Sheets con Service Account
function getSheetsServiceClient() {
  const auth = getServiceAccountAuth();
  return google.sheets({ version: 'v4', auth });
}

// Crear cliente de Drive con Service Account
function getDriveServiceClient() {
  const auth = getServiceAccountAuth();
  return google.drive({ version: 'v3', auth });
}

// Verificar permisos en una hoja
async function checkSheetPermissions(sheetId, auth) {
  try {
    const sheets = getSheetsClient(auth);
    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: 'properties.title,sheets.properties'
    });
    return {
      hasAccess: true,
      title: response.data.properties.title,
      sheets: response.data.sheets
    };
  } catch (error) {
    if (error.code === 403) {
      return { hasAccess: false, error: 'No permission to access this sheet' };
    } else if (error.code === 404) {
      return { hasAccess: false, error: 'Sheet not found' };
    }
    throw error;
  }
}

// Compartir hoja con service account
async function shareSheetWithServiceAccount(sheetId, serviceAccountEmail) {
  try {
    const drive = getDriveServiceClient();
    await drive.permissions.create({
      fileId: sheetId,
      resource: {
        role: 'reader',
        type: 'user',
        emailAddress: serviceAccountEmail
      }
    });
    return true;
  } catch (error) {
    console.error('Error sharing sheet with service account:', error);
    return false;
  }
}

// Crear hoja de productos con template
async function createProductSheet(auth, storeName) {
  try {
    const sheets = getSheetsClient(auth);
    const drive = getDriveClient(auth);
    
    // Crear nueva hoja de cálculo
    const spreadsheet = await sheets.spreadsheets.create({
      resource: {
        properties: {
          title: `Control Store - ${storeName} - Productos`
        },
        sheets: [{
          properties: {
            title: 'Productos',
            gridProperties: {
              rowCount: 1000,
              columnCount: 10
            }
          }
        }]
      }
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const sheetId = spreadsheet.data.sheets[0].properties.sheetId;

    // Agregar headers del template
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'A1:J1',
      valueInputOption: 'RAW',
      resource: {
        values: [[
          'Nombre',
          'Descripción', 
          'Variedades 1',
          'Variedades 1 Título',
          'Variedades 2',
          'Variedades 2 Título',
          'Categoría',
          'Precio',
          'Precio anterior',
          'Imagen (URL)'
        ]]
      }
    });

    // Formatear headers
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.6, blue: 0.9 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }]
      }
    });

    return {
      spreadsheetId,
      sheetId,
      editUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    };
  } catch (error) {
    console.error('Error creating product sheet:', error);
    throw error;
  }
}

// Leer productos de la hoja
async function readProductsFromSheet(sheetId) {
  try {
    const sheets = getSheetsServiceClient();
    
    // Leer datos de la hoja
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A:J' // Todas las columnas
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      return { products: [], categories: [] };
    }

    // Saltar header (primera fila)
    const dataRows = rows.slice(1);
    const products = [];
    const categories = new Set();

    dataRows.forEach((row, index) => {
      if (row.length === 0 || !row[0]) return; // Fila vacía o sin nombre

      const product = {
        id: `row_${index + 2}`, // ID basado en número de fila
        nombre: row[0] || '',
        descripcion: row[1] || '',
        variedades1: row[2] || '',
        variedades1Titulo: row[3] || '',
        variedades2: row[4] || '',
        variedades2Titulo: row[5] || '',
        categoria: row[6] || '',
        precio: parseFloat(row[7]) || 0,
        precioAnterior: parseFloat(row[8]) || 0,
        imagenUrl: row[9] || '',
        rowIndex: index + 2
      };

      products.push(product);
      if (product.categoria) {
        categories.add(product.categoria);
      }
    });

    return {
      products,
      categories: Array.from(categories).sort()
    };
  } catch (error) {
    console.error('Error reading products from sheet:', error);
    throw error;
  }
}

// Crear backup de la hoja
async function createSheetBackup(originalSheetId, storeName) {
  try {
    const drive = getDriveServiceClient();
    
    // Copiar la hoja
    const copyResponse = await drive.files.copy({
      fileId: originalSheetId,
      resource: {
        name: `Backup - ${storeName} - ${new Date().toISOString().split('T')[0]}`
      }
    });

    const backupFileId = copyResponse.data.id;
    const backupUrl = `https://drive.google.com/file/d/${backupFileId}/view`;

    return {
      backupFileId,
      backupUrl
    };
  } catch (error) {
    console.error('Error creating sheet backup:', error);
    throw error;
  }
}

module.exports = {
  getTokensFromAuthCode,
  getSheetsClient,
  getDriveClient,
  getSheetsServiceClient,
  getDriveServiceClient,
  checkSheetPermissions,
  shareSheetWithServiceAccount,
  createProductSheet,
  readProductsFromSheet,
  createSheetBackup
};
