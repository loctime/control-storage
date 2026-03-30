# ControlFile / ControlStorage — Auditoría de mensajes + Copy “Sobre nosotros”

Este documento sintetiza las **verdades de producto** a partir de `TRUTH.md` y `01_overview.md` y propone el **copy listo** para la sección “Sobre nosotros” de la landing.

---

## 1) Verdades de producto (auditadas)

1. ControlFile es la **infraestructura centralizada de gestión de archivos** para todo el ecosistema Control\*.
2. Es un **backend compartido**, no una app: múltiples aplicaciones lo usan como capa de storage.
3. ControlFile **centraliza seguridad, permisos y acceso**; las apps no gestionan directamente URLs presignadas, CORS ni acceso a storage.
4. **Un archivo no pertenece a una app; pertenece al sistema.** Las apps referencian archivos y solicitan acceso.
5. ControlFile **define cómo se accede** a los archivos y protege el storage real; las apps no acceden al storage directamente.
6. ControlFile también actúa como **capa IAM compartida**, creando identidades y claims para el ecosistema.
7. El frontend de ControlFile es **solo UI administrativa**; no participa en flujos críticos de archivos.
8. El acceso a archivos es **seguro y controlado** mediante mecanismos temporales/proxy, nunca público directo.

---

## 2) Copy “Sobre nosotros” (alto nivel, no técnico)

### Párrafo principal
Somos la capa de almacenamiento central del ecosistema ControlApp. ControlFile (ControlStorage) unifica los archivos de todas las apps en un entorno único, con autenticación y permisos compartidos, para que la información esté organizada por app y colección, sin silos ni duplicación.

### Diferenciadores (3–5)
- **Centralización real**: un solo storage transversal para todo el ecosistema.
- **Permisos consistentes**: las mismas reglas y sesión para todas las apps.
- **Trazabilidad transversal**: orden por app/colecciones y visibilidad de extremo a extremo.
- **Escalabilidad por diseño**: nuevas apps heredan el storage común sin duplicar infraestructura.
- **Menos complejidad**: cada app se enfoca en su dominio, no en archivos.

### Cómo se integra (bloque corto)
ControlFile se integra como backend común: las apps mantienen su lógica propia, pero delegan en la plataforma la gestión de archivos, autenticación y permisos.

### Resultados que habilita (mini‑bloque)
Menos silos de información, control unificado, trazabilidad transversal y un time‑to‑market más rápido para nuevas apps.

---

## 3) Notas de uso

- Este copy evita stack, endpoints y términos de bajo nivel.
- Todo lo afirmado está respaldado por `TRUTH.md` y `01_overview.md`.
- Si se requiere una versión técnica, puede derivarse desde estas mismas verdades.
