# Propuesta de la versión 0.3.0 de Ramcrack Request

**Estado:** borrador para decisión · **Fecha:** 7 de noviembre de 2026 · **Base:** versión 0.2.1 publicada
**Alcance de este documento:** análisis y propuesta. **No se ha modificado código.** Lo único que se cambió es el README (aviso de seguridad sobre `.api-request/`), que es documentación.

---

## 1. Resumen ejecutivo

| | |
|---|---|
| **Recomendación** | Empezar por **carpetas dentro de las colecciones**, junto con un paquete pequeño de **higiene de seguridad** para `.api-request/`. |
| **Después** | **Cookies persistentes** y un **ejecutor de colecciones**, y por último **OAuth 2** (es el de mayor tamaño y riesgo). |
| **Por qué ese orden** | Las carpetas cambian el modelo de datos, y todo lo demás (ejecutor, importadores, herencia de configuración) se apoya en él. Cookies y OAuth añaden credenciales sensibles, así que conviene tener antes la higiene de seguridad. |
| **Versionado** | Microsoft recomienda minor **impar** para pre-lanzamientos. Propongo publicar la **0.3.0 como pre-lanzamiento** para tus estudiantes y la **0.4.0 como versión estable** (ver sección 6). |
| **Decisiones que necesito de ti** | Sección 9. |

> Las estimaciones de esfuerzo son **relativas** (S pequeño, M mediano, L grande), no un calendario. Lo que no he podido verificar está marcado como tal en la sección 8.

---

## 2. Punto de partida y lo que mostraron las pruebas reales

La 0.2.1 está publicada en el Marketplace y se probó con una API real (CRUD de equipos, con login, `POST`, `PUT` y `DELETE`, contrastado contra MySQL). Funciona. Esas pruebas dejaron estas observaciones:

| # | Observación | Evidencia | Severidad | Propuesta |
|---|---|---|---|---|
| 1 | Un **token pegado** en Auth se guarda en texto plano en `.api-request/collections.json` | Captura de la pestaña Auth con un JWT | **Alta** (riesgo al subir a git) | Higiene de seguridad (4.2) |
| 2 | El resultado de *Set Env Variable* dice **"(entorno activo)"** cuando la variable quedó en **Globales** | Pestaña Resultados + panel Entornos | Baja (mensaje impreciso) | Corrección menor (4.2) |
| 3 | Se **reutiliza una sola petición** cambiando el método; la colección queda con 2 peticiones y no refleja la API | Barra lateral | Media (usabilidad) | Carpetas + duplicar (4.1) |
| 4 | Peticiones **GET y DELETE con cuerpo** escrito, que se ignora o es inusual | Pestaña Body | Baja | Pista visual (4.2) |
| 5 | Con muchos endpoints, la lista **plana** se vuelve difícil de manejar | Uso del proyecto | Media | Carpetas (4.1) |
| 6 | No hay forma de **ejecutar todas** las peticiones seguidas ni de ver un resumen de tests | CRUD manual de 6 pasos | Media | Ejecutor (4.5) |

---

## 3. Alcance propuesto

| Mejora | Valor | Esfuerzo | Riesgo | Versión propuesta |
|---|---|---|---|---|
| **Carpetas dentro de colecciones** (con arrastrar y soltar) | Alto | M | Medio (cambia el modelo de datos) | **0.3.0** |
| **Higiene de seguridad** de `.api-request/` (aviso en README, `.gitignore` automático, aviso de secretos en texto plano) | Alto | S | Bajo | **0.3.0** |
| Correcciones menores (mensaje de variables, pistas en Body) | Medio | S | Bajo | **0.3.0** |
| **Cookies persistentes** entre peticiones | Medio-Alto | M | Medio (maneja credenciales de sesión) | **0.3.0** (decidido; va después de la higiene de seguridad) |
| **Editor del cuerpo JSON**: sangría automática, Tab, autocierre de llaves y comillas (propuesto a raíz de un comentario de un usuario) | Alto | S-M | Bajo | **0.3.0** |
| **Diferenciación de nombres** (API `tc.*`, etiquetas de la interfaz) | Medio | S | Bajo | **0.3.0** |
| **Ejecutor de colecciones** con resumen de tests | Alto | M | Bajo | 0.4.0 |
| **OAuth 2**: Client Credentials | Medio | M | Medio | 0.5.0 |
| **OAuth 2**: Authorization Code con PKCE | Medio | L | Alto | 0.6.0 (o después) |
| Herencia de headers/auth/variables por carpeta | Medio | M | Medio | Fase 2 de carpetas |

**Alternativa:** incluir las tres mejoras en una sola versión. **No la recomiendo:** mezcla un cambio de modelo de datos con dos funciones que guardan credenciales, y si algo falla es difícil saber cuál lo causó.

---

## 4. Detalle por mejora

### 4.1 Carpetas dentro de las colecciones (prioridad 1)

**Qué resuelve:** organizar una API real (Auth, Equipos, Usuarios…) y dejar la colección como documentación de la API.

**Modelo de datos.** Hoy: `Colección → peticiones[]`. Propuesto:

```text
Colección
 ├─ carpetas[]  (cada carpeta: id, nombre, peticiones[], carpetas[])
 └─ peticiones[]
```

- **Compatible hacia atrás:** el campo `carpetas` es opcional. Un `collections.json` de la 0.2.x se abre sin cambios. Al cargar, se normaliza añadiendo `carpetas: []`.
- **Anidación:** sin límite técnico; recomendación de uso: hasta 3 niveles.
- **Orden de visualización:** carpetas primero, luego peticiones.
- **Copia de seguridad:** antes de guardar por primera vez con el formato nuevo, crear `collections.backup.json`.

**Comportamiento del árbol (barra lateral):**
- Nuevo tipo de nodo *carpeta* con icono de carpeta y menú contextual.
- **Arrastrar y soltar** para mover peticiones y carpetas, con el control de arrastre que ofrece la API de árboles de VS Code.
- Alternativa sin ratón: comando **"Mover a…"** con un selector jerárquico.

**Comandos nuevos:** nueva carpeta, renombrar, eliminar (con confirmación si tiene contenido), duplicar carpeta (copia profunda con ids nuevos) y mover.

**Cambios internos necesarios (para dimensionar el riesgo):**
- Hoy una petición se localiza por `colección + id`. Con carpetas debe buscarse **por id en todo el árbol**. Esto afecta al almacén de datos, al panel de la petición y al historial.
- El historial, al reabrir una petición, debe permitir elegir **colección o carpeta** de destino.
- Los **importadores** pasan de aplanar (`Carpeta / Petición`) a **crear carpetas reales** al importar Postman v2.1 y Thunder Client.

**Fase 2 (opcional, después de estabilizar):** headers, autenticación y variables **heredables** por carpeta o colección.

**Criterios de aceptación:**
1. Un `collections.json` de la 0.2.1 abre sin errores ni pérdida de datos.
2. Se puede crear, renombrar, mover (arrastrando y por comando), duplicar y eliminar carpetas.
3. Abrir, editar y enviar una petición dentro de una carpeta funciona igual que antes.
4. Importar una colección Postman con carpetas anidadas reproduce la estructura.
5. Las pruebas automáticas pasan (ver sección 7).

**Riesgos:** regresiones al cambiar cómo se localizan las peticiones; pérdida de orden al arrastrar; datos de la 0.2.x modificados por error. Mitigación: copia de seguridad, migración aditiva y pruebas del almacén antes de tocar la interfaz.

### 4.2 Higiene de seguridad de `.api-request/` (prioridad 1, paquete pequeño)

**Problema:** la extensión guarda las peticiones tal como se escriben. Un token, contraseña o clave de API escritos a mano acaban en `collections.json`, dentro del proyecto, y pueden subirse a git.

| Medida | Descripción | Esfuerzo |
|---|---|---|
| **Aviso en el README** | Sección sobre qué guarda `.api-request/`, buenas prácticas y qué hacer si se filtra un secreto. **Ya incluida** en el README. | — |
| **`.gitignore` automático** | La extensión crea `.api-request/.gitignore` con `environments.json` y `cookies.json` (cuando exista). Así `collections.json` se puede versionar y lo sensible no. Git respeta los `.gitignore` anidados. | S |
| **Aviso de secretos en texto plano** | Al guardar, detectar un Bearer escrito a mano (que no sea `{{variable}}`) o campos de Headers/Body llamados `password`, `token`, `secret` o `api_key` con un valor literal. Mostrar un aviso discreto con la sugerencia de usar una variable y la opción de no volver a mostrarlo. Configurable. | S-M |
| **Mensaje de *Set Env Variable*** | Decir **"global"** cuando no hay entorno activo (hoy dice "entorno activo"). | S |
| **Pistas en la pestaña Body** | Aviso cuando una petición **GET o HEAD** tiene cuerpo escrito (se ignora) o cuando un **DELETE** lo lleva. | S |

**Límites que conviene tener claros:** el aviso de secretos es una **heurística**: puede dar falsos positivos y no detecta todos los casos. No sustituye la revisión antes de hacer *commit*. Una persona que ya haya subido un secreto debe **revocarlo**; borrarlo del último commit no basta porque queda en el historial.

### 4.3 Cookies persistentes entre peticiones (prioridad 2)

**Qué resuelve:** APIs con sesión por cookie, donde hoy hay que copiar la cookie a mano de una respuesta a la siguiente petición.

**Diseño propuesto:**
- Un **almacén de cookies** (`.api-request/cookies.json`, protegido por el `.gitignore` automático) que guarda `Set-Cookie` de cada respuesta y las envía en las peticiones siguientes que coincidan por dominio, ruta, expiración y `Secure`.
- Reglas inspiradas en RFC 6265, simplificadas (sin `SameSite`, que es una política de navegador).
- **Redirecciones:** `fetch` no conserva cookies entre saltos. Para soportarlo hay que **gestionar las redirecciones manualmente** (hasta 10 saltos), aplicando las cookies en cada una. Es la parte más delicada.
- Interfaz: la pestaña **Cookies** de la respuesta ya existe; se añade una vista de cookies por dominio con opción de borrar, y el comando **Limpiar cookies**.
- Ajustes: activar o desactivar (propuesta: activado) y una opción por petición.

**Riesgo principal:** las cookies de sesión son **credenciales**. Por eso depende de la higiene de seguridad de 4.2.

**Criterios de aceptación:** un servidor local de prueba que emite `Set-Cookie` y exige la cookie en la petición siguiente; expiración y `Secure` respetados; las cookies no se envían a otro dominio; limpiar cookies funciona.

### 4.4 OAuth 2 (prioridad 3)

**Qué resuelve:** APIs protegidas por OAuth 2 (Auth0, Azure AD, Keycloak, Google…).

**Fases:**
- **Fase 1: Client Credentials.** Sin navegador. Campos: URL del token, client id, client secret, scope, audience, y envío de credenciales por header o por cuerpo. Se guarda el token con su vencimiento y se renueva al caducar. Esfuerzo M.
- **Fase 2: Authorization Code con PKCE.** Abre el navegador, recibe el código en un servidor local de loopback (`127.0.0.1`, puerto aleatorio, como recomienda el estándar para aplicaciones nativas), intercambia el código y usa *refresh token*. Esfuerzo L, riesgo alto.

**Almacenamiento seguro:** el *client secret*, los tokens y los *refresh tokens* se guardarían en el **almacén de secretos de VS Code (`SecretStorage`)**, no en archivos del proyecto. En la petición solo quedaría la configuración no secreta.

**Riesgos:** cada proveedor tiene particularidades; `SecretStorage` podría comportarse distinto en editores derivados de VS Code (**no verificado**); requiere una **revisión de seguridad** específica. Se probaría con un servidor OAuth falso local, y después con al menos un proveedor real.

### 4.5 Ejecutor de colecciones (propuesta nueva)

Ejecutar todas las peticiones de una colección o carpeta en orden, con un **resumen de tests** (aprobadas, falladas, tiempo). Surge directamente del CRUD que hiciste a mano en seis pasos. Depende de las carpetas. Esfuerzo M.

### 4.6 Editor del cuerpo JSON (nuevo, surgió del piloto)

**Origen:** un usuario que probó la extensión comentó que *"un detalle importante a mejorar es la sangría del JSON que uno manda"*. **Confirmado:** se refiere a que, **al escribir** en la pestaña Body, el cuadro **no se sangra solo (no se indenta)**. Hoy la única forma de ordenarlo es pulsar el botón **Formatear**, que además exige que el JSON ya sea válido.

**Estado actual:** el cuerpo se escribe en un cuadro de texto con colores superpuestos. No es un editor de código, así que no tiene las ayudas habituales.

**Mejoras (las cuatro primeras son el núcleo de lo reportado):**
| Si se refiere a… | Mejora |
|---|---|
| Que al pulsar **Enter** no se mantiene ni aumenta la sangría | Auto-sangría: mantener la sangría de la línea anterior y añadir un nivel después de `{` o `[` |
| Que **Tab** salta fuera del cuadro en vez de sangrar | Tab inserta espacios; Mayús+Tab los quita |
| Que se escriben `{` o `"` y hay que cerrarlos a mano | Autocierre de llaves, corchetes y comillas |
| Que el JSON pegado queda mal sangrado | **Formatear** al pegar (opcional) y atajo `Ctrl+Mayús+F` |
| *(No es lo reportado; idea opcional)* Que el JSON **enviado** lleve la sangría del editor | La extensión envía el texto **tal cual** está escrito. Se podría ofrecer "compactar al enviar" |

**Tab (reportado también):** hoy **Tab no sangra**: el foco sale del cuadro hacia el siguiente control. La mejora hará que Tab inserte la sangría (2 espacios) y Mayús+Tab la quite. **Accesibilidad:** capturar Tab deja atrapado a quien navega con teclado, así que se añadirá una salida: **Esc** y luego **Tab** mueve el foco fuera del cuadro (es la convención de los editores).

**Criterios de aceptación:** escribir un JSON anidado de cuatro niveles sin tocar el ratón y que quede bien sangrado; **Tab** y **Mayús+Tab** sangran y quitan sangría, incluso con varias líneas seleccionadas; **Esc + Tab** permite salir del cuadro; que **Formatear** lo deje con 2 espacios; que los atajos no rompan el resto de la página.
**Riesgo:** bajo. Un editor completo (Monaco) sería más pesado; se propone ampliar el cuadro actual.

### 4.7 Diferenciación de nombres (nuevo) — ✅ hecho (ver sección 11)

Para reducir parecidos innecesarios con otras herramientas, se propone cambiar los nombres que se copiaron por compatibilidad:
- La API de scripts `tc.setVar()` / `tc.getVar()` pasaría a un nombre propio, por ejemplo `rr.*`, con la antigua **aceptada como alias durante una versión** para no romper scripts existentes.
- Etiquetas de la interfaz en inglés (**Set Env Variable**, **Pre Run**) pasarían a español, por ejemplo **Guardar en variable** y **Pre-ejecución**.

**Qué no cambia:** los formatos de importación (Postman, Thunder Client y cURL) siguen igual: nombrar un formato para poder abrirlo es un uso descriptivo.
**Esfuerzo:** S. **Riesgo:** bajo, salvo por scripts de Pre Run ya escritos (de ahí el alias temporal).

---

## 5. Orden de trabajo (por fases, sin fechas)

1. **Fase A: Almacén de datos.** Modelo con carpetas, migración, copia de seguridad, importadores y pruebas. *Sin tocar la interfaz.*
2. **Fase B: Interfaz.** Árbol con carpetas, comandos, arrastrar y soltar, historial.
3. **Fase C: Higiene de seguridad.** `.gitignore` automático, aviso de secretos, mensajes y pistas.
4. **Fase D: Documentación y piloto.** README, guía, publicación como pre-lanzamiento y prueba con estudiantes.
5. **Fase E: Cookies persistentes** y **mejoras del editor JSON y de nombres** (4.3, 4.6 y 4.7), una vez que la higiene de seguridad (Fase C) proteja `cookies.json`.
6. **Después:** ejecutor de colecciones (0.4.0) y OAuth 2 (0.5.0 y posteriores).

Cada fase termina con `npm test` en verde antes de pasar a la siguiente.

---

## 6. Versionado y publicación

> **Decisión final (7 de nov de 2026):** se publica **todo en la 0.3.0, como versión normal**. Lo que sigue en esta sección se conserva como análisis de la alternativa (pre-lanzamiento y 0.4.0), que **no se va a usar**.

- Microsoft recomienda **minor par** para lanzamientos normales (0.2.x) y **minor impar** para pre-lanzamientos (0.3.x).
- **Propuesta:** publicar **0.3.0 como pre-lanzamiento** (`vsce publish --pre-release`). Quien quiera probarla elige *"Cambiar a versión de pre-lanzamiento"* en la página de la extensión; el resto de usuarios sigue en la estable.
- Tras el piloto, publicar **0.4.0 como versión estable**. Los números de pre-lanzamiento y de lanzamiento deben ser distintos.
- Cambio necesario en el flujo `publish-marketplace.yml`: añadir una opción *pre-lanzamiento* que pase `--pre-release`. **No se ha hecho** (es un cambio de código del flujo).
- **No verificado:** cómo se comporta el pre-lanzamiento en tu cuenta de publisher. Habría que comprobarlo con la primera publicación.
- **Alternativa:** publicar 0.3.0 como versión normal. Es válido, solo se aparta de la convención recomendada.

---

## 7. Plan de pruebas

**Automáticas (ya existen 38 comprobaciones; se ampliarían):**
- **Almacén:** crear, mover, duplicar, eliminar carpetas; búsqueda por id en árbol; migración desde un archivo de la 0.2.1 sin `carpetas`.
- **Importadores:** Postman con carpetas anidadas; Thunder Client con carpetas.
- **Arranque simulado:** que los comandos nuevos estén registrados y la apertura de una petición dentro de una carpeta funcione.
- **Cookies (0.4.0):** coincidencia por dominio, ruta, expiración y `Secure`; no enviar a otro dominio.

**Manuales:** repetir el escenario CRUD de `LABORATORIO_CRUD` con una colección organizada en carpetas; importar una colección real con carpetas; abrir un proyecto con un `collections.json` de la 0.2.1.

**Piloto:** instalar la pre-lanzamiento con estudiantes y recoger comentarios en **Issues** antes de publicar la estable.

---

## 8. Riesgos y lo que no sé

| Tema | Detalle |
|---|---|
| **Estimaciones** | Son relativas; no son una promesa de calendario. |
| **Sistemas operativos** | Todas las pruebas reales se hicieron en **Windows**. En macOS y Linux no se han probado. |
| **Editores derivados** | Solo se ha visto el comportamiento en VS Code. `SecretStorage` y el arrastrar y soltar no se han verificado en otros. |
| **Pre-lanzamiento** | No comprobado en tu cuenta del Marketplace. |
| **Defender** | Aunque se instale desde el Marketplace, Defender puede volver a marcar `vars.js` (falso positivo). El reporte a Microsoft sigue pendiente. |
| **OAuth** | Las diferencias entre proveedores son impredecibles; por eso va el último y por fases. |

---

## 9. Decisiones que necesito de ti

1. **Alcance de la 0.3.0:** ✅ **Decidido (7 de nov de 2026): opción (B), carpetas + higiene de seguridad + cookies persistentes.** La recomendación original era la (A); al sumar cookies crece el riesgo (ver 4.3), así que las cookies entran **después** de la higiene de seguridad, para que `cookies.json` ya nazca protegido.
2. ✅ **Decidido (7 de nov de 2026): todo en la 0.3.0, publicada directamente como versión normal.** Sin pre-lanzamiento y sin 0.2.2, para no complicar el proceso. La sección 6 (pre-lanzamiento y 0.4.0) queda como alternativa no utilizada.
3. **`.gitignore` automático:** ¿que la extensión cree `.api-request/.gitignore` sola, o prefieres solo avisarlo en el README?
4. **Aviso de secretos:** ¿activado por defecto (con opción de desactivarlo)?
5. **Cookies:** ¿activadas por defecto cuando lleguen?
6. **OAuth:** ¿qué proveedor usas o usarás? Eso decide por dónde empezar la Fase 1.

---

## 10. Cambio ya aplicado

En el README se añadió la sección **"Seguridad: no subas datos sensibles a git"**, que explica qué guarda `.api-request/`, cómo usar variables, qué poner en el `.gitignore` y qué hacer si se filtra un secreto. Estará visible en el Marketplace con la próxima versión que se publique.

---

## 11. Estado de la implementación

### Fase A (almacén de carpetas): **completada** el 7 de noviembre de 2026
Sin tocar la interfaz. Archivos: `src/types.ts`, `src/model.ts`, `src/store.ts`, `scripts/test-store.js` y el script `npm test`.

**Qué hace ahora el almacén:**
- **Modelo:** `Colección → carpetas (anidadas) → peticiones`. El campo `folders` es opcional en disco y se normaliza a `[]` al cargar.
- **Migración segura:** abrir un `collections.json` de la 0.2.x **no lo modifica**. Al primer guardado se crea `collections.backup.json` idéntico al original, **una sola vez**. Los campos desconocidos de una colección se conservan.
- **Búsqueda por id en todo el árbol:** `getRequest`, `updateRequest`, `duplicateRequest` y `deleteRequest` conservan su forma `(colección, petición)`, así que el panel de peticiones y el resto del código **no necesitaron cambios**.
- **Carpetas:** `addFolder` (con padre opcional), `renameFolder`, `deleteFolder` (con todo su contenido), `duplicateFolder` (copia profunda con ids nuevas) y `getFolder`.
- **Mover:** `moveRequest` y `moveFolder`, dentro de una colección o **entre colecciones**, con posición final opcional. Una carpeta **no puede moverse dentro de sí misma ni de sus subcarpetas**.
- **`listContainers()`**: lista colecciones y carpetas con su ruta legible (`Colección / Carpeta / Sub`), para los selectores "Mover a…" y "Guardar en…" de la Fase B.

**Decisiones tomadas al implementar:**
- `collections.json` **sigue siendo una lista de colecciones** (no se añadió un número de esquema), para que una 0.2.x que lea un archivo nuevo no falle: ignora las carpetas, pero no las borra, porque conserva los campos que no conoce.
- La posición `index` al mover es la **posición final** en la lista de destino.
- Los importadores aplanaban las carpetas de Postman y Thunder Client (`Carpeta / Petición`); se cambiaron en la Fase B (ver abajo).

**Pruebas:** 86 comprobaciones en total (28 del motor, **48 del almacén**, 10 del arranque). Las nuevas cubren migración, copia de seguridad, anidado hasta 3 niveles, duplicar con ids únicas, mover (incluido entre colecciones y movimientos prohibidos), borrado en cascada y que el estado en disco coincida con el de memoria.

**Lo que no cubren:** el rendimiento con colecciones muy grandes.

### Apartado 4.7 (diferenciación de nombres): **hecho** el 7 de noviembre de 2026
Se adelantó a petición del usuario, por ser de bajo riesgo.
- **API de scripts:** `rr.setVar()` / `rr.getVar()`. El objeto antiguo `tc` se mantiene como **alias** (misma función) y se retirará en una versión futura. Una prueba automática garantiza que ambos funcionan.
- **Interfaz:** **Guardar en variable** (antes *Set Env Variable*) y **Pre-ejecución** (antes *Pre Run*), en la pestaña Tests, la pestaña de pre-ejecución y los títulos de la pestaña Resultados. El mensaje de error del motor ahora dice "Error en la pre-ejecución".
- **Documentación:** README y CHANGELOG actualizados. Las entradas **históricas** del CHANGELOG (0.1.x y 0.2.x) conservan los nombres antiguos a propósito, porque describen lo que se publicó entonces.
- **Qué no cambió:** el vocabulario HTTP estándar (Headers, Body, Query, Auth, Cookies…), los formatos de importación y la sintaxis de variables `{{...}}`.
- **Pruebas:** 30 del motor (antes 28; se añadieron las del alias `tc` y de `rr.getVar` con ámbito global).

### Corrección encontrada en pruebas reales: tipo de contenido de archivos — **hecha** el 7 de noviembre de 2026
Al probar el CRUD completo contra una API real (LABORATORIO_CRUD, con imágenes), una petición **multipart con un archivo `.png`** recibía **400 "Formato de imagen no permitido"**. Causa: la extensión enviaba el archivo **sin tipo de contenido** y el servidor exige `image/png`, `image/jpeg` o `image/webp`. Con el mismo archivo y el tipo indicado, el servidor respondía 201.
- **Corrección:** `mimeFromPath()` deduce el tipo por la extensión (imágenes, PDF, texto, CSV, JSON, XML, ZIP, audio, vídeo y formatos de Office); lo desconocido sigue siendo `application/octet-stream`. Se aplica a los campos **File** de Form y al body **Binary**; un `Content-Type` escrito por el usuario tiene prioridad.
- **Pruebas:** 5 nuevas (35 del motor en total). Verificado de nuevo contra la API real: el multipart con imagen da **201**, la imagen se guarda y se borra con su registro.
- **Publicación:** viaja con la **0.3.0**. Decisión del usuario (7 de nov de 2026): **no se saca una 0.2.2**; todo se publica junto en la 0.3.0 para no complicar el proceso.

### Fase B (interfaz de carpetas): **completada** el 7 de noviembre de 2026
- **Árbol:** nodos `colección → carpeta → petición`, carpetas primero; `getParent` implementado (necesario para revelar elementos).
- **Comandos:** `Nueva carpeta` (barra, menú y botones en línea de colección y carpeta; sin nodo abre un selector de destino), `Mover a…` (excluye la carpeta y sus descendientes), renombrar/duplicar/eliminar también para carpetas. Eliminar muestra el recuento de lo que se pierde.
- **Arrastrar y soltar** (`TreeDragAndDropController`, tipo `application/vnd.code.tree.apirequest.collections`): sobre carpeta o colección = mover dentro; sobre petición = colocar antes (con el ajuste del índice final al reordenar en la misma lista); mover una carpeta dentro de sí misma se rechaza.
- **Selectores:** `pickContainer` reemplaza a `pickCollection` (importar cURL, guardar desde actividad, nueva carpeta, mover).
- **Importadores:** Postman (`item[]` anidado, carpetas vacías incluidas) y Thunder (`_id` / `containerId`, peticiones huérfanas a la raíz, ciclos tolerados) crean carpetas reales; `ImportedCollection` ahora trae `folders`.
- **Pruebas:** 113 en total (37 del motor, 48 del almacén, **28 del arranque**; antes 10). Cubren crear/renombrar/duplicar/eliminar/mover, arrastrar y soltar (incluido el rechazo y el reordenar), confirmaciones, selector e importación.
- **No cubierto automáticamente:** el aspecto real del árbol y el arrastre con el ratón dentro de VS Code (la API se simula); hay que probarlo a mano con el `.vsix`.
- **Herramienta añadida:** `scripts/smoke-lab-crud.js` (`npm run smoke:lab`), la prueba contra una API real, sin contraseñas en el código.

### Fase C (higiene de seguridad): **completada** el 7 de noviembre de 2026
- **`.gitignore` automático:** `.api-request/.gitignore` con `environments.json`, `cookies.json` y `collections.backup.json` (la copia de seguridad lleva lo mismo que `collections.json`). Solo cuando los datos están en el proyecto; si el archivo ya existe se **completa sin borrar ni duplicar** nada. `collections.json` queda versionable. `cookies.json` ya nace protegido para la Fase E.
- **Aviso de secretos** (`src/secrets.ts`): detecta Bearer, contraseña Basic, API key, headers sensibles (`Authorization`, `X-API-Key`…) y campos `password`/`token`/`secret`/`api_key` en JSON, form-urlencoded y multipart, siempre que el valor sea literal (un `{{token}}` no avisa). Se muestra **al enviar**, **una vez por petición y sesión**, con "No volver a avisar" (`apiRequest.warnPlainSecrets`). No bloquea el envío ni avisa al guardar, para no molestar mientras se escribe. Limitación: es una heurística por nombre de campo, no detecta un secreto dentro de un campo con otro nombre ni en la URL.
- **Mensaje de *Guardar en variable*:** `(global)` sin entorno activo, `(entorno "nombre")` con él.
- **Pista en Body:** GET/HEAD con body (se ignora) y DELETE con body (poco habitual).
- **Pruebas:** 131 en total (46 del motor, 53 del almacén, 32 del arranque).

### Fase E (cookies persistentes y editor del body): **completada** el 7 de noviembre de 2026
- **Cookies** (`src/cookiejar.ts`): almacén con dominio (solo del host exacto si no hay `Domain`; con `Domain`, también subdominios; se rechaza un `Domain` ajeno al host), ruta (por defecto el directorio de la petición), `Max-Age` (manda sobre `Expires`), `Expires`, `Secure` (solo se acepta y envía por https), `HttpOnly` (se guarda, no aplica a un cliente), sustitución por nombre+dominio+ruta, borrado con `Max-Age=0`. Se persiste en `cookies.json` (ya cubierto por el `.gitignore` de la Fase C).
- **Motor:** con almacén, las redirecciones se siguen a mano (máx. 10, con error claro si se pasa); sin almacén todo funciona como antes. Un `Cookie` escrito por el usuario gana al almacén. Entre orígenes distintos se quitan `Authorization` y `Cookie`.
- **Comando** `Limpiar cookies guardadas` (por dominio o todas; no muestra valores) y ajuste `apiRequest.useCookies`.
- **Editor** (`media/editing.js`, funciones puras): Enter con sangría, Tab/Mayús+Tab (incluye multilínea), autocierre y salto sobre el cierre, Retroceso de pares, Ctrl+Mayús+F, Esc+Tab. Se aplica con `execCommand('insertText')` para conservar Ctrl+Z.
- **Pruebas:** 189 en total (46 motor, 53 almacén, **28 cookies**, **24 editor**, 38 arranque). Además se probó el editor en un navegador real (vista previa): se tecleó un JSON de 4 niveles y quedó bien sangrado y válido, Ctrl+Z lo deshace, Tab inserta y Esc+Tab deja pasar el foco.
- **Límites conocidos:** no hay `SameSite` ni lista de sufijos públicos (un `Domain=com` se aceptaría desde un host `.com`); las cookies de sesión también se guardan en disco; no hay opción de cookies por petición ni vista del contenido de las cookies (solo borrar por dominio); el autocierre no se activa en XML/texto; "formatear al pegar" no se implementó. Falta probar el panel dentro de VS Code real (CSP, `execCommand`).

### Pendiente
Fase D (documentación y piloto con estudiantes) y la publicación de la 0.3.0.
