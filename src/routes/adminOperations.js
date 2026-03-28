/**
 * adminOperations.js
 * Endpoints de administración de operaciones sobre la colección apps/emails/vehicles.
 * Montado bajo /api/admin, protegido con authMiddleware en el mount.
 *
 * GET    /api/admin/operations              → Lista operaciones agrupadas
 * POST   /api/admin/operations              → Valida y reserva nombre de operación
 * PUT    /api/admin/operations/:nombre      → Edita responsables de una operación
 * DELETE /api/admin/operations/:nombre      → Libera todos los vehículos a SIN_ASIGNAR
 * POST   /api/admin/operations/:nombre/plates      → Asigna una patente a una operación
 * DELETE /api/admin/operations/:nombre/plates/:plate → Quita una patente de una operación
 */

const express = require("express");
const router = express.Router();
const admin = require("../firebaseAdmin");
const { normalizeEmailArray } = require("../shared/normalizeEmail");

const db = admin.firestore();

const VEHICLES_REF = db.collection("apps").doc("emails").collection("vehicles");
const ACCESS_REF = db.collection("apps").doc("emails").collection("access");

const MAX_BATCH_SIZE = 500;
const DEFAULT_OPERATION = "SIN_ASIGNAR";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Normaliza una patente: elimina caracteres no alfanuméricos y convierte a mayúsculas.
 */
function normalizePlate(plate) {
  if (!plate || typeof plate !== "string") return "";
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().trim();
}

/**
 * Verifica que el usuario autenticado tenga role === "admin" en apps/emails/access.
 * Devuelve true si es admin, false si no existe o tiene otro rol.
 */
async function isEmailAdmin(email) {
  if (!email) return false;
  const snap = await ACCESS_REF.doc(email.trim().toLowerCase()).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return data.role === "admin" && data.enabled !== false && data.active !== false;
}

/**
 * Ejecuta un array de funciones batch.set/update en lotes de MAX_BATCH_SIZE.
 * Recibe un array de { ref, data, type: "set"|"update" }.
 */
async function commitInBatches(operations) {
  for (let i = 0; i < operations.length; i += MAX_BATCH_SIZE) {
    const chunk = operations.slice(i, i + MAX_BATCH_SIZE);
    const batch = db.batch();
    for (const op of chunk) {
      if (op.type === "set") {
        batch.set(op.ref, op.data, { merge: true });
      } else {
        batch.update(op.ref, op.data);
      }
    }
    await batch.commit();
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/admin/operations
// ─────────────────────────────────────────────────────────────

router.get("/operations", async (req, res) => {
  try {
    if (!(await isEmailAdmin(req.user?.email))) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
    }

    const snap = await VEHICLES_REF.get();

    const groups = {};
    for (const doc of snap.docs) {
      const data = doc.data();
      const nombre = data.operacion || data.operationName || DEFAULT_OPERATION;
      if (!groups[nombre]) {
        groups[nombre] = { nombre, plates: [], responsables: [] };
      }
      groups[nombre].plates.push(doc.id);
      // Usar responsablesNormalized como fuente de verdad
      const responsables = Array.isArray(data.responsablesNormalized)
        ? data.responsablesNormalized
        : normalizeEmailArray(Array.isArray(data.responsables) ? data.responsables : []);
      for (const email of responsables) {
        if (!groups[nombre].responsables.includes(email)) {
          groups[nombre].responsables.push(email);
        }
      }
    }

    return res.json(Object.values(groups));
  } catch (err) {
    return res.status(500).json({ error: "Error al obtener operaciones.", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/admin/operations
// ─────────────────────────────────────────────────────────────

router.post("/operations", async (req, res) => {
  try {
    if (!(await isEmailAdmin(req.user?.email))) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
    }

    const { nombre, responsables } = req.body || {};

    if (!nombre || typeof nombre !== "string" || !nombre.trim()) {
      return res.status(400).json({ error: "El campo 'nombre' es requerido y no puede estar vacío." });
    }

    const nombreTrimmed = nombre.trim();

    if (nombreTrimmed === DEFAULT_OPERATION) {
      return res.status(400).json({ error: `'${DEFAULT_OPERATION}' es un valor reservado y no puede usarse como nombre de operación.` });
    }

    // Verificar que no exista ya una operación con ese nombre
    const existing = await VEHICLES_REF.where("operacion", "==", nombreTrimmed).limit(1).get();
    if (!existing.empty) {
      return res.status(409).json({ error: `Ya existe una operación con el nombre '${nombreTrimmed}'.` });
    }

    // Validar responsables si se proporcionaron
    const responsablesNormalized = normalizeEmailArray(
      Array.isArray(responsables) ? responsables : []
    );

    return res.status(201).json({
      ok: true,
      nombre: nombreTrimmed,
      responsables: responsablesNormalized,
      message: "Operación registrada. Asigná patentes con POST /api/admin/operations/:nombre/plates",
    });
  } catch (err) {
    return res.status(500).json({ error: "Error al crear operación.", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/admin/operations/:nombre
// ─────────────────────────────────────────────────────────────

router.put("/operations/:nombre", async (req, res) => {
  try {
    if (!(await isEmailAdmin(req.user?.email))) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
    }

    const { nombre } = req.params;
    const { responsables } = req.body || {};

    if (!Array.isArray(responsables)) {
      return res.status(400).json({ error: "El campo 'responsables' debe ser un array de emails." });
    }

    const responsablesNormalized = normalizeEmailArray(responsables);

    const snap = await VEHICLES_REF.where("operacion", "==", nombre).get();
    if (snap.empty) {
      return res.status(404).json({ error: `No se encontraron vehículos con operacion '${nombre}'.` });
    }

    const operations = snap.docs.map((doc) => ({
      ref: doc.ref,
      type: "update",
      data: {
        responsables: responsablesNormalized,
        responsablesNormalized,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    }));

    await commitInBatches(operations);

    return res.json({ ok: true, updated: operations.length });
  } catch (err) {
    return res.status(500).json({ error: "Error al actualizar responsables.", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/admin/operations/:nombre
// ─────────────────────────────────────────────────────────────

router.delete("/operations/:nombre", async (req, res) => {
  try {
    if (!(await isEmailAdmin(req.user?.email))) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
    }

    const { nombre } = req.params;

    const snap = await VEHICLES_REF.where("operacion", "==", nombre).get();
    if (snap.empty) {
      return res.status(404).json({ error: `No se encontraron vehículos con operacion '${nombre}'.` });
    }

    const operations = snap.docs.map((doc) => ({
      ref: doc.ref,
      type: "update",
      data: {
        operacion: DEFAULT_OPERATION,
        operationName: DEFAULT_OPERATION,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    }));

    await commitInBatches(operations);

    return res.json({ ok: true, released: operations.length });
  } catch (err) {
    return res.status(500).json({ error: "Error al eliminar operación.", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/admin/operations/:nombre/plates
// ─────────────────────────────────────────────────────────────

router.post("/operations/:nombre/plates", async (req, res) => {
  try {
    if (!(await isEmailAdmin(req.user?.email))) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
    }

    const { nombre } = req.params;
    const { plate: rawPlate } = req.body || {};

    if (!rawPlate || typeof rawPlate !== "string") {
      return res.status(400).json({ error: "El campo 'plate' es requerido." });
    }

    const plate = normalizePlate(rawPlate);
    if (!plate) {
      return res.status(400).json({ error: "La patente proporcionada no es válida." });
    }

    const vehicleRef = VEHICLES_REF.doc(plate);
    const vehicleSnap = await vehicleRef.get();

    if (!vehicleSnap.exists) {
      return res.status(404).json({ error: `No existe el vehículo '${plate}' en la base de datos.` });
    }

    await vehicleRef.update({
      operacion: nombre,
      operationName: nombre,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, plate });
  } catch (err) {
    return res.status(500).json({ error: "Error al asignar patente.", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/admin/operations/:nombre/plates/:plate
// ─────────────────────────────────────────────────────────────

router.delete("/operations/:nombre/plates/:plate", async (req, res) => {
  try {
    if (!(await isEmailAdmin(req.user?.email))) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere rol admin." });
    }

    const { nombre, plate: rawPlate } = req.params;

    const plate = normalizePlate(rawPlate);
    if (!plate) {
      return res.status(400).json({ error: "La patente proporcionada no es válida." });
    }

    const vehicleRef = VEHICLES_REF.doc(plate);
    const vehicleSnap = await vehicleRef.get();

    if (!vehicleSnap.exists) {
      return res.status(404).json({ error: `No existe el vehículo '${plate}' en la base de datos.` });
    }

    const data = vehicleSnap.data();
    const currentOperacion = data.operacion || data.operationName;

    if (currentOperacion !== nombre) {
      return res.status(400).json({
        error: `La patente '${plate}' no pertenece a la operación '${nombre}'. Operación actual: '${currentOperacion || DEFAULT_OPERATION}'.`,
      });
    }

    await vehicleRef.update({
      operacion: DEFAULT_OPERATION,
      operationName: DEFAULT_OPERATION,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, plate });
  } catch (err) {
    return res.status(500).json({ error: "Error al quitar patente.", detail: err.message });
  }
});

module.exports = router;
