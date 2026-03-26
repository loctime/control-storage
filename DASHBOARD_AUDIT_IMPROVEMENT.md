# Dashboard Audit & Improvement

## Overview
Implemented audit and enrichment features for the dashboard endpoint to eliminate duplicate data reads and ensure data consistency between legacy (`dailyAlerts`) and correct (`apps/emails/vehicles`) sources.

## Problem Statement
- The `/api/dashboard/summary` endpoint was returning data from `apps/emails/dailyAlerts/{date}/vehicles` which are legacy documents with incorrect metadata
- The frontend had to make additional requests to `/apps/emails/vehicles/{plate}` for each vehicle to get the correct `operacion` and `responsables`
- This resulted in N+1 queries: 1 dashboard request + 1 request per vehicle

## Solution
Implemented three new components:

### 1. **dashboardAuditService.js**
Service for auditing dashboard data consistency.

**Functions:**
- `auditDashboardData(dateKey)` - Main audit function
- `getLegacyDailyAlertsVehicles(dateKey)` - Reads legacy data from dailyAlerts
- `getCorrectVehicles(plates)` - Reads correct data from apps/emails/vehicles
- `isLegacyResponsables(responsables)` - Detects legacy email patterns

**Usage:**
```javascript
const auditResult = await auditDashboardData('2026-03-25');
// Returns: totalVehicles, vehiclesWithOperacion, mismatches, legacyEmailsFound, etc.
```

### 2. **dashboardEnrichmentService.js**
Service for enriching dashboard data with correct vehicle information.

**Functions:**
- `getDashboardSummaryEnriched(dateKey, options)` - Enriches full summary (with concurrency control)
- `enrichVehicle(dailyAlertsVehicle)` - Enriches a single vehicle
- `getVehicleData(plate)` - Reads vehicle data from apps/emails/vehicles
- `getEnrichedVehicle(plate, dateKey)` - Gets enriched data for a single vehicle

**Key Features:**
- Reads from `apps/emails/dailyAlerts/{date}/vehicles` (legacy data)
- Enriqueces with data from `apps/emails/vehicles/{plate}` (correct data)
- Prefers vehicle data for `operacion` and `responsables`
- Includes enrichment statistics: succeeded, failed counts
- Concurrent enrichment with configurable max concurrency (default: 10)

**Usage:**
```javascript
const result = await getDashboardSummaryEnriched('2026-03-25', { maxConcurrency: 10 });
// Returns: summary, distribution, criticalAlerts, topVehicles, recentEvents, riskMap
// Plus: enrichmentStats { total, succeeded, failed }
```

### 3. **New Endpoints**

#### GET `/api/dashboard/enriched?date=YYYY-MM-DD`
Returns enriched dashboard summary with correct vehicle data.

**Response:**
```json
{
  "ok": true,
  "date": "2026-03-25",
  "summary": {
    "totalVehicles": 150,
    "vehiclesWithEvents": 120,
    "totalEvents": 500,
    "criticalEvents": 15,
    "adminEvents": 25,
    "maxRisk": 8.5,
    "avgRisk": 4.2
  },
  "distribution": {
    "excesos": 300,
    "no_identificados": 100,
    "contactos": 50,
    "llave_sin_cargar": 30,
    "conductor_inactivo": 20
  },
  "criticalAlerts": [
    {
      "plate": "ABC123",
      "riskScore": 8.5,
      "totalEvents": 45,
      "operationName": "Operation A",
      "responsables": ["driver1@email.com", "driver2@email.com"]
    }
  ],
  "topVehicles": [...],
  "recentEvents": [...],
  "riskMap": [...],
  "enrichmentStats": {
    "total": 150,
    "succeeded": 149,
    "failed": 1
  }
}
```

#### GET `/api/dashboard/audit?date=YYYY-MM-DD`
Returns audit report of data inconsistencies.

**Response:**
```json
{
  "ok": true,
  "date": "2026-03-25",
  "totalVehicles": 150,
  "vehiclesWithOperacion": 145,
  "vehiclesWithoutOperacion": 5,
  "vehiclesWithValidResponsables": 140,
  "vehiclesWithLegacyResponsables": 10,
  "legacyEmailsFound": [
    "controldoc@controldoc.app",
    "info@controldoc.app",
    "system@company.com"
  ],
  "mismatches": [
    {
      "plate": "ABC123",
      "operacionFromDailyAlerts": "Operacion A",
      "operacionFromVehicles": "Operacion B",
      "match": false
    }
  ],
  "summary": "3 vehicles have inconsistencies between dailyAlerts and /vehicles"
}
```

## Benefits

### For Frontend
- **Single Request:** Only 1 request needed to get complete dashboard data
- **Complete Data:** `operacion` and `responsables` are already included
- **Better Performance:** No N+1 query pattern

### For Backend
- **Data Consistency:** Uses correct source (apps/emails/vehicles) as primary for operacion/responsables
- **Auditability:** Can detect and track data inconsistencies
- **Logging:** Enrichment stats help monitor data quality
- **Reusability:** Services can be used in any context

### Data Quality
- Detects legacy email patterns in responsables
- Identifies operacion mismatches between sources
- Provides fallback to legacy data if enrichment fails
- Marks enrichment source in response metadata

## Migration Guide

### For Frontend
Replace dashboard requests:

**Before:**
```javascript
// Request 1: Get dashboard summary
const dashboard = await fetch('/api/dashboard/summary?date=2026-03-25');
// Request 2+N: Enrich each vehicle
for (const vehicle of dashboard.topVehicles) {
  const enriched = await fetch(`/apps/emails/vehicles/${vehicle.plate}`);
}
```

**After:**
```javascript
// Single request: Get enriched dashboard
const dashboard = await fetch('/api/dashboard/enriched?date=2026-03-25');
// Data is already enriched, no additional requests needed
```

### For Auditing
Run audit periodically to detect inconsistencies:

```javascript
const audit = await fetch('/api/dashboard/audit?date=2026-03-25');
// Review mismatches and legacy emails
if (audit.mismatches.length > 0) {
  console.warn('Found inconsistencies:', audit.mismatches);
}
```

## Implementation Details

### Concurrency Control
The enrichment service uses configurable concurrency to avoid overwhelming Firestore:
- Default: 10 concurrent vehicle enrichments
- Can be customized: `{ maxConcurrency: 5 }` for lighter load

### Error Handling
- Individual vehicle enrichment failures don't block the whole request
- Failed enrichments fall back to legacy data
- Enrichment stats track success/failure rates
- Detailed logging for debugging

### Data Source Priority
When enriching vehicles:
1. **apps/emails/vehicles/{plate}** - Primary (correct) source
2. **dailyAlerts/{date}/vehicles** - Fallback (legacy) source

## Files Modified/Created

### New Files
- `src/services/dashboardAuditService.js` - Audit service
- `src/services/dashboardEnrichmentService.js` - Enrichment service

### Modified Files
- `src/routes/dashboard.js` - Added `/enriched` and `/audit` endpoints

## Logging

### Enriched Summary
```
[dashboard/enriched] OK {
  dateKey: "2026-03-25",
  totalVehicles: 150,
  enrichmentStats: { total: 150, succeeded: 149, failed: 1 }
}
```

### Audit
```
[dashboard/audit] Audit completed {
  dateKey: "2026-03-25",
  totalVehicles: 150,
  mismatchesFound: 3,
  legacyEmailsCount: 2
}
```

## Testing

### Manual Testing
```bash
# Test enriched endpoint
curl "http://localhost:3000/api/dashboard/enriched?date=2026-03-25"

# Test audit endpoint
curl "http://localhost:3000/api/dashboard/audit?date=2026-03-25"

# Test without date (uses latest)
curl "http://localhost:3000/api/dashboard/enriched"
```

### Expected Behavior
- Both endpoints should return within seconds (with <1000 vehicles)
- Enrichment should succeed for 95%+ of vehicles
- Audit should detect any metadata inconsistencies
