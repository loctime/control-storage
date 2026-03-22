# Google Sheets API - Control Store

## Descripción
API para integrar Google Sheets con Control Store, permitiendo que cada tienda gestione sus productos a través de hojas de cálculo de Google.

## Variables de Entorno Requeridas

```bash
# OAuth para autenticación de usuarios
GOOGLE_CLIENT_ID=tu_client_id_aqui
GOOGLE_CLIENT_SECRET=tu_client_secret_aqui

# Service Account para operaciones server-to-server
GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-service-account@proyecto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"..."}
```

## Endpoints

### 1. Crear Hoja de Productos
**POST** `/api/stores/:storeId/sheets/create`

Crea una nueva hoja de Google Sheets para la tienda con template de productos.

**Body:**
```json
{
  "authCode": "4/0AX4XfWh..." // Código de autorización del OAuth popup
}
```

**Respuesta:**
```json
{
  "success": true,
  "sheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  "editUrl": "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
}
```

**Errores:**
- `400` - `AUTH_CODE_MISSING`: Falta el código de autorización
- `400` - `INVALID_AUTH_CODE`: Código de autorización inválido
- `404` - `STORE_NOT_FOUND`: Tienda no encontrada
- `500` - `SHEET_CREATION_FAILED`: Error al crear la hoja

### 2. Obtener Productos
**GET** `/api/stores/:storeId/products`

Lee los productos desde la hoja de Google Sheets (con caché de 5 minutos).

**Query Parameters:**
- `forceRefresh` (opcional): `true` para ignorar caché

**Respuesta:**
```json
{
  "products": [
    {
      "id": "row_2",
      "nombre": "Producto 1",
      "descripcion": "Descripción del producto",
      "variedades1": "Talla S,M,L",
      "variedades1Titulo": "Tallas",
      "variedades2": "Rojo,Azul,Verde",
      "variedades2Titulo": "Colores",
      "categoria": "Ropa",
      "precio": 29.99,
      "precioAnterior": 39.99,
      "imagenUrl": "https://ejemplo.com/imagen.jpg",
      "rowIndex": 2
    }
  ],
  "categories": ["Ropa", "Accesorios", "Calzado"],
  "cached": false
}
```

**Errores:**
- `404` - `STORE_NOT_FOUND`: Tienda no encontrada
- `404` - `NO_SHEET_CONFIGURED`: No hay hoja configurada
- `403` - `SHEET_ACCESS_DENIED`: Sin permisos para acceder a la hoja
- `404` - `SHEET_NOT_FOUND`: Hoja no encontrada
- `500` - `PRODUCTS_FETCH_FAILED`: Error al obtener productos

### 3. Sincronizar Productos
**POST** `/api/stores/:storeId/sheets/sync`

Fuerza la sincronización de productos desde la hoja hacia Firestore.

**Respuesta:**
```json
{
  "success": true,
  "count": 25,
  "products": 25,
  "categories": 5
}
```

**Errores:**
- `404` - `STORE_NOT_FOUND`: Tienda no encontrada
- `404` - `NO_SHEET_CONFIGURED`: No hay hoja configurada
- `403` - `SHEET_ACCESS_DENIED`: Sin permisos para acceder a la hoja
- `404` - `SHEET_NOT_FOUND`: Hoja no encontrada
- `500` - `SYNC_FAILED`: Error en la sincronización

### 4. Crear Backup
**POST** `/api/stores/:storeId/backup`

Crea una copia de seguridad de la hoja en nuestro Drive.

**Respuesta:**
```json
{
  "success": true,
  "backupUrl": "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view"
}
```

**Errores:**
- `404` - `STORE_NOT_FOUND`: Tienda no encontrada
- `404` - `NO_SHEET_CONFIGURED`: No hay hoja configurada
- `403` - `SHEET_ACCESS_DENIED`: Sin permisos para acceder a la hoja
- `404` - `SHEET_NOT_FOUND`: Hoja no encontrada
- `500` - `BACKUP_FAILED`: Error al crear backup

## Template de la Hoja

La hoja creada automáticamente incluye las siguientes columnas:

| Columna | Descripción | Ejemplo |
|---------|-------------|---------|
| A - Nombre | Nombre del producto | "Camiseta Básica" |
| B - Descripción | Descripción detallada | "Camiseta de algodón 100%" |
| C - Variedades 1 | Opciones de variedad 1 | "S,M,L,XL" |
| D - Variedades 1 Título | Título para variedad 1 | "Tallas" |
| E - Variedades 2 | Opciones de variedad 2 | "Rojo,Azul,Verde" |
| F - Variedades 2 Título | Título para variedad 2 | "Colores" |
| G - Categoría | Categoría del producto | "Ropa" |
| H - Precio | Precio actual | "29.99" |
| I - Precio anterior | Precio anterior (opcional) | "39.99" |
| J - Imagen (URL) | URL de la imagen | "https://ejemplo.com/imagen.jpg" |

## Flujo de Integración

1. **Configuración OAuth**: El frontend obtiene un `authCode` del OAuth popup de Google
2. **Crear Hoja**: Se llama a `/api/stores/:storeId/sheets/create` con el `authCode`
3. **Configurar Permisos**: La hoja se comparte automáticamente con el service account
4. **Leer Productos**: Se usa `/api/stores/:storeId/products` para obtener productos
5. **Sincronizar**: Se usa `/api/stores/:storeId/sheets/sync` para actualizar Firestore
6. **Backup**: Se usa `/api/stores/:storeId/backup` para crear copias de seguridad

## Caché

- Los productos se cachean en memoria por 5 minutos
- Usar `?forceRefresh=true` para ignorar caché
- El caché se limpia automáticamente al sincronizar

## Seguridad

- Todos los endpoints requieren autenticación Bearer token
- La hoja se comparte con el service account como "Lector"
- Los permisos de escritura quedan con el usuario original
- Validación de permisos en cada operación

## Ejemplo de Uso

```javascript
// 1. Crear hoja
const createResponse = await fetch('/api/stores/store123/sheets/create', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    authCode: '4/0AX4XfWh...'
  })
});

// 2. Obtener productos
const productsResponse = await fetch('/api/stores/store123/products', {
  headers: {
    'Authorization': `Bearer ${idToken}`
  }
});

// 3. Sincronizar
const syncResponse = await fetch('/api/stores/store123/sheets/sync', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`
  }
});

// 4. Crear backup
const backupResponse = await fetch('/api/stores/store123/backup', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${idToken}`
  }
});
```
