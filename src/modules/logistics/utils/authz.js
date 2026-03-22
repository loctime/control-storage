const admin = require("../../../firebaseAdmin");
const { ApiError } = require("./apiError");

const ELEVATED_ROLES = new Set(["admin", "manager", "maxdev", "factory"]);

function getUsersCollection() {
  return admin.firestore().collection("apps").doc("horarios").collection("users");
}

async function getMembership(uid) {
  const snap = await getUsersCollection().doc(uid).get();
  if (!snap.exists) {
    throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "Usuario no autorizado para horarios");
  }
  return { uid, ...snap.data() };
}

function hasElevatedRole(member) {
  return ELEVATED_ROLES.has((member.role || "").toLowerCase());
}

async function assertOwnerBranchAccess({ uid, ownerId, branchId }) {
  if (!ownerId) {
    throw new ApiError(400, "VALIDATION_ERROR", "ownerId es obligatorio");
  }

  if (uid === ownerId) {
    return { uid, ownerId, branchId: branchId || null, role: "owner" };
  }

  const member = await getMembership(uid);
  if (member.ownerId !== ownerId) {
    throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "El usuario no pertenece al owner indicado");
  }

  if (!branchId) {
    return member;
  }

  if (member.branchId && member.branchId !== branchId && !hasElevatedRole(member)) {
    throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "El usuario no tiene acceso a la sucursal indicada");
  }

  return member;
}

function assertActorMatch({ uid, member, actorId }) {
  if (!actorId) return;
  if (actorId === uid) return;
  if (hasElevatedRole(member)) return;
  throw new ApiError(403, "FORBIDDEN_OWNER_BRANCH", "actorId no coincide con el usuario autenticado");
}

module.exports = {
  assertOwnerBranchAccess,
  assertActorMatch,
  hasElevatedRole,
};
