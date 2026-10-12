# ADR 0003: Sistema de diseño del panel administrativo — App GYM

- **Fecha:** 2026-10-12
- **Estado:** Aceptado
- **Aplica a:** apps/web (SPA/PWA) — panel administrativo, portal del socio, mostrador de recepción
- **Relacionado / reemplaza:** complementa ADR 0002 (arquitectura base). Fuente: investigación de diseño delegada (subagente, modelo principal) con comparativa de Mantine/Chakra/Ant Design/MUI; decisión del usuario «backend primero, UI después en una sola pasada» del 2026-10-12.

## 1. Contexto y Problema

El panel actual (`apps/web`) usa CSS propio básico (src/style.css, dark theme). La Entrega 2 introduce socios, planes, pagos con validación, caja y más adelante check-in QR — vistas densas con tablas, formularios, modales y estados. Se necesita un sistema de componentes que:

1. Escale a paneles de datos densos sin reescribir CSS a mano.
2. Permita theming multi-tenant (paleta por organización) sin recompilar.
3. Sea accesible (WAI-ARIA) y funcione en equipos modestos de recepción (bundle liviano).
4. Sea open-source sin costo de licencia.

Alternativas evaluadas: Tailwind+Radix (patrón shadcn/ui), Mantine v7, Chakra UI v2/v3, Ant Design v5, MUI v5/v6.

## 2. Decisión

**Tailwind CSS v3 + Radix UI primitives + patrón shadcn/ui integrado en Vite**, con:

- `@tanstack/react-table` para tablas densas (socios, pagos, caja).
- `lucide-react` para iconografía.
- `sonner` para toasts.
- `class-variance-authority` + `clsx` + `tailwind-merge` para variantes de componentes.

Justificación: bundle mínimo (solo CSS de clases usadas + primitivas atómicas ~2-5KB gzip por componente), theming por variables CSS (`:root`, `[data-theme]`) personalizable por tenant en runtime, accesibilidad WAI-ARIA garantizada por Radix (foco, teclado, screen readers) sin diseño impuesto, integración nativa con Vite/React 18, 100% open-source (MIT/Apache-2.0). Estética inspirada en Linear/Stripe Dashboard/Attio, acorde al dark theme actual.

Descartadas: Mantine (bundle base ~140KB, theming menos desacoplado), Chakra v2 (Emotion en runtime penaliza tablas densas; v3 inestable), Ant Design (bundle ~300KB, estética corporativa rígida, i18n Day.js), MUI (Emotion, estética Material poco ágil para recepción).

## 3. Aplicabilidad y Reglas para Agentes

- **Obligaciones:**
  - Componentes UI se construyen sobre Radix + Tailwind siguiendo el patrón shadcn (código propio en `apps/web/src/components/ui/`, no dependencia de CLI externa).
  - Tokens de color/tipografía como variables CSS; el theming por tenant se aplica con atributos `data-*` en `<html>` o en el contenedor raíz — nunca recompilando Tailwind por organización.
  - Las tablas de datos usan `@tanstack/react-table`; no escribir tablas ad-hoc para listados con búsqueda/filtro/paginación.
  - Toda acción financiera crítica (validar/rechazar pago, cerrar caja) pasa por AlertDialog de confirmación; los resultados se comunican con toasts (sonner).
  - Autorización: la UI refleja roles pero NUNCA autoriza — el backend re-valida (ADR 0002 §3).
- **Prohibiciones:**
  - No introducir CSS-in-JS en runtime (Emotion/styled-components) en el panel.
  - No duplicar autorización ni confiar en restricciones de interfaz.
  - No fijar versiones sin verificar compatibilidad con React 18 + Vite 5.

## 4. Consecuencias

### Positivas

- Panel denso y moderno sin costo de licencia; mantenible por tokens.
- Accesibilidad sólida desde las primitivas Radix.
- Theming multi-tenant sin recompilación (prepara la personalización por gimnasio).

### Negativas / Trade-offs

- shadcn/ui no es dependencia npm: los componentes son código propio que hay que mantener y actualitar (trade-off aceptado: control total, cero lock-in).
- Tailwind v3 (no v4): migración futura a evaluar cuando el ecosistema se estabilice.

### Verificación / Migración

- Se aplica en la unidad de UI de la Entrega 2 (spec 003 §4 protege apps/web hasta entonces).
- Verificación: gate del proyecto + build de producción de apps/web; la revisión Tier 1 de la 003 incluye los flujos con la UI nueva.
