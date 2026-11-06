# Changelog

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
