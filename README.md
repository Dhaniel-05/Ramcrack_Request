# Ramcrack Request

Cliente REST simple e intuitivo para VS Code, inspirado en Thunder Client. Sin cuentas, sin nube, sin límites de colecciones. Todo se guarda en archivos JSON de tu proyecto.

Autor: **Ramcrack**

## Características

**Petición**
- Métodos GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, PROPFIND y CUSTOM.
- **Query** sincronizada con la URL, **Headers** con autocompletado.
- **Auth:** Basic, Bearer y API Key (en header o query).
- **Body:** JSON, XML, Text, Form (multipart con archivos), Form-encode, GraphQL y Binary.
- **Tests:** aserciones con selectores (status, tiempo, header, JSON, body) y operadores (=, ≠, contiene, >, ≥, <, ≤, existe, regex).
- **Set Env Variable:** guarda `json.token`, `header.x`, `cookie.sid` o `text` en una variable (`{{token}}` o `{{token, global}}`).
- **Pre Run:** script JavaScript con `tc.setVar()` / `tc.getVar()`.
- **Docs:** documenta cada endpoint.

**Respuesta**
- Estado, tamaño y tiempo. Vistas JSON, Árbol, Texto y Raw con filtro JSONPath.
- Pestañas Headers, Cookies y Resultados de tests.
- Snippets de código: cURL, fetch, axios y Python.

**Organización**
- Colecciones, entornos (con variables globales) y actividad reciente.
- **Variables del sistema:** `{{#guid}}`, `{{#name}}`, `{{#string}}`, `{{#number}}`, `{{#number, 1, 100}}`, `{{#email}}`, `{{#bool}}`, `{{#enum, a, b}}`, `{{#date}}`, `{{#date, 'YYYY-MM-DD'}}`, `{{#dateISO}}`.
- **Importar:** Postman v2.1, exportaciones de Thunder Client y comandos cURL.
- Atajos: `Ctrl+Enter` envía, `Ctrl+S` guarda.

## Instalación

El instalador está en la carpeta `release/` del repositorio. Descarga el `.vsix` más reciente e instálalo:

```bash
code --install-extension release/ramcrack-request-0.1.2.vsix
```

O desde VS Code: **Extensiones** (`Ctrl+Shift+X`) → menú `···` → **Instalar desde VSIX…**. Luego recarga la ventana.

## Uso rápido

1. Abre el icono **Ramcrack Request** (flechas ⇄) en la barra lateral.
2. Crea una colección y una petición (o importa una desde Postman, Thunder Client o cURL).
3. Escribe la URL y pulsa **Enviar**.

### Flujo típico: login + token

1. Petición `POST {{baseUrl}}/auth/login` con tu body JSON.
2. En **Tests → Set Env Variable**: origen `json.token`, destino `{{token}}`.
3. En las demás peticiones: **Auth → Bearer** con `{{token}}`.

### Dónde se guardan los datos

En la carpeta `.api-request/` del proyecto abierto:
- `collections.json`: las peticiones (puedes versionarlo con git).
- `environments.json`: variables y secretos (agrégalo a tu `.gitignore`).

Sin carpeta abierta se usa el almacenamiento global de la extensión.

### Configuración

- `apiRequest.timeout`: tiempo máximo por petición (ms). Por defecto 30000.
- `apiRequest.followRedirects`: seguir redirecciones. Por defecto activo.

## Desarrollo

```bash
npm install
npm run compile
npm run test:http   # pruebas del motor
# F5 en VS Code para abrir una ventana de pruebas
npm run package     # genera el instalador en release/
```

`node scripts/serve.js` sirve la interfaz del panel en `http://localhost:5173/preview` con una API de ejemplo, para diseñar sin abrir VS Code.

## Licencia

MIT
