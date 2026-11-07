# Changelog

## 0.3.0
- Nombres propios y en español: **Set Env Variable** pasa a **Guardar en variable** y **Pre Run** a **Pre-ejecución**. La API de los scripts pasa de `tc.setVar()` / `tc.getVar()` a `rr.setVar()` / `rr.getVar()`; **`tc` sigue funcionando como alias** por compatibilidad y se retirará en una versión futura.
- **Corrección:** los archivos enviados en **Form (multipart)** y en **Binary** ahora llevan su tipo de contenido, deducido de la extensión (`.png` → `image/png`, `.jpg`, `.webp`, `.pdf`…). Antes salían sin tipo, y las APIs que solo aceptan imágenes (`image/png`, `image/jpeg`, `image/webp`) respondían 400. Un `Content-Type` escrito a mano en Headers sigue teniendo prioridad.
- **Carpetas dentro de las colecciones**, anidadas a cualquier profundidad. Nueva carpeta desde la barra, desde el menú de una colección o carpeta, o con sus botones en línea; renombrar, duplicar (copia profunda) y eliminar (avisa cuánto contenido se pierde).
- **Arrastrar y soltar** peticiones y carpetas: sobre una carpeta o colección las mueve dentro; sobre otra petición las coloca antes (reordenar). Una carpeta no se puede soltar dentro de sí misma. **Mover a…** hace lo mismo desde el menú contextual, con teclado.
- **Nueva petición** sobre una carpeta la crea dentro de ella. Importar cURL y guardar desde la actividad permiten elegir colección o carpeta.
- **Importar Postman v2.1 y Thunder Client crea carpetas reales** (antes aplanaba los nombres como `Carpeta / Petición`).
- **Cookies persistentes** entre peticiones: se guardan las `Set-Cookie` de cada respuesta en `.api-request/cookies.json` y se envían en las siguientes del mismo dominio (dominio, ruta, caducidad y `Secure` respetados; no se mandan a otros hosts). Con almacén de cookies las redirecciones se siguen a mano (hasta 10 saltos): las cookies de cada salto se guardan, 303 y 301/302 tras POST pasan a GET, 307/308 conservan método y cuerpo, y al cambiar de origen no se reenvían `Authorization` ni `Cookie`. Nuevo comando **Limpiar cookies guardadas** y ajuste `apiRequest.useCookies`.
- **Editor del body:** Enter conserva la sangría y suma un nivel tras `{` / `[`; Tab y Mayús+Tab sangran y desangran (también varias líneas); autocierre de `{`, `[` y `"` en JSON; Retroceso borra el par vacío; Ctrl+Mayús+F formatea; **Esc y luego Tab** saca el foco del cuadro. Las ediciones se pueden deshacer con Ctrl+Z.
- **Seguridad:** la extensión crea `.api-request/.gitignore` (sin tocar lo que el usuario ya tenga) con `environments.json`, `cookies.json` y `collections.backup.json`, para poder versionar `collections.json` sin subir secretos por descuido.
- **Aviso de secretos en texto plano:** al enviar una petición con un Bearer, contraseña Basic, API key, header `Authorization` o campo `password`/`token`/`secret`/`api_key` escrito a mano (no `{{variable}}`), se muestra un aviso discreto, una vez por petición, con la opción "No volver a avisar" (`apiRequest.warnPlainSecrets`).
- **Mensaje más claro:** *Guardar en variable* dice **(global)** cuando no hay entorno activo, y `(entorno "dev")` cuando sí lo hay (antes decía siempre "entorno activo").
- **Pista en Body:** aviso cuando una petición GET/HEAD tiene body (no se envía) o un DELETE lo lleva (poco habitual).
- Migración automática de los archivos de la 0.2.x, con copia de seguridad `collections.backup.json` antes del primer guardado.
- Herramientas de desarrollo: `npm run smoke:lab` (prueba contra una API real; las credenciales se leen del entorno, no hay ninguna en el código, y pide confirmación porque escribe en la base de datos).

## 0.2.1
- README: la instalación recomendada pasa a ser el Marketplace de VS Code; el `.vsix` queda como alternativa.
- Enlace de patrocinio (GitHub Sponsors): botón **Sponsor** en el repositorio y en la página del Marketplace.
- La guía de estudiantes pasa a ser el plan B, y se documenta el error `Parameter name: v1` al subir por el cargador equivocado.

## 0.2.0
- Primera versión publicada en el Visual Studio Marketplace.
- Icono PNG de la extensión y banner de la galería.
- El empaquetado crea la carpeta `release/` si no existe (arregla el flujo automático en GitHub).
- Textos neutrales: se quitan las menciones de marcas de las palabras clave y se añade un aviso de marcas.

## 0.1.3
- Arranque explícito de la extensión (`activationEvents`), para editores derivados de VS Code donde el arranque automático no se disparaba.
- Diagnóstico: canal de salida "Ramcrack Request" y mensaje con el motivo exacto si el arranque falla.

## 0.1.2
- Nuevo icono de la barra lateral: un matraz de laboratorio.
- Nuevo nombre: **Ramcrack Request** (identificador `ramcrack-request`). Los datos siguen en `.api-request/`.
- El body (JSON y XML) se muestra con colores mientras escribes.
- El nombre automático de una petición nueva usa solo la ruta (antes repetía el método en el título).

## 0.1.1
- "Nueva petición" abre el panel al instante, sin pedir colección ni nombre.

## 0.1.0
- Interfaz de dos columnas (petición | respuesta) con pestañas Query, Headers, Auth, Body, Tests y Pre Run.
- Body: JSON, XML, Text, Form (multipart con archivos), Form-encode, GraphQL y Binary.
- Auth: Basic, Bearer y API Key.
- Tests con aserciones y "Set Env Variable"; resultados en la respuesta.
- Script Pre Run con `tc.setVar` / `tc.getVar`.
- Respuesta: Headers, Cookies, Resultados, Docs, vistas JSON/Árbol/Texto/Raw y filtro JSONPath.
- Snippets de código (cURL, fetch, axios, Python).
- Entornos con variables globales y variables del sistema (`{{#guid}}`, `{{#date}}`…).
- Importar Postman v2.1, Thunder Client y cURL.
- Vistas de Entornos y Actividad en la barra lateral.
- Los datos de la 0.0.x se migran automáticamente.

## 0.0.2
- Interfaz de dos columnas y snippets.

## 0.0.1
- Primera versión.
