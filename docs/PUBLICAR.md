# Publicar Ramcrack Request

Guía para sacar una versión nueva: GitHub compila la extensión, crea el instalador `.vsix` y lo publica en **Releases**. Es el mismo flujo que usan Gastrobar, Desktop Capture Pro y el Descargador de videos.

---

## 1. Una sola vez

1. El repositorio debe ser **público** para que cualquiera pueda descargar los Releases.
2. En GitHub → **Settings → Actions → General → Workflow permissions**, elige **Read and write permissions**.
3. Sube a `main` el archivo `.github/workflows/release.yml` (ya está en el proyecto).

## 2. Publicar una versión nueva

1. Prueba los cambios (`F5` en VS Code abre una ventana de pruebas) y ejecuta `npm run test:http`.
2. Anota los cambios en `CHANGELOG.md`, en una sección con el número de la versión (por ejemplo `## 0.1.3`). Ese texto se usa como notas del Release.
3. Haz commit de todo. `npm version` exige que no haya cambios pendientes.
4. Sube el número de versión. Elige uno:
   - `npm version patch` → 0.1.2 → 0.1.3 (arreglos)
   - `npm version minor` → 0.1.3 → 0.2.0 (funciones nuevas)
   - `npm version major` → 0.2.0 → 1.0.0 (versión estable)

   Cambia `package.json`, hace un commit y crea la etiqueta (por ejemplo `v0.1.3`).
5. Sube el commit y la etiqueta:
   ```bash
   git push
   git push --tags
   ```
6. En la pestaña **Actions** del repositorio verás el flujo "Publicar versión". En 1 o 2 minutos aparece el Release con el `.vsix` adjunto.

Si la etiqueta no coincide con la versión de `package.json`, el flujo se detiene y te lo dice.

Mientras la versión sea `0.x`, el Release se marca como **pre-release**. Al llegar a `1.0.0` queda como versión estable y el enlace `/releases/latest` empieza a funcionar:

`https://github.com/Dhaniel-05/Ramcrack_Request/releases/latest`

## 3. Cómo instalan la extensión

Descargan el `.vsix` del Release y ejecutan:

```bash
code --install-extension ramcrack-request-0.1.3.vsix
```

O desde VS Code: **Extensiones** (`Ctrl+Shift+X`) → menú `···` → **Instalar desde VSIX…**

Las extensiones instaladas desde un `.vsix` **no se actualizan solas**: para actualizar hay que instalar el `.vsix` nuevo.

## 4. Más adelante: Visual Studio Marketplace

Con el Marketplace, VS Code actualiza la extensión automáticamente. Hace falta:
1. Un publisher llamado `ramcrack` en https://marketplace.visualstudio.com/manage
2. Un token de Azure DevOps con permiso **Marketplace → Manage**.
3. Guardarlo como secreto `VSCE_PAT` del repositorio (Settings → Secrets and variables → Actions) y añadir al flujo un paso `npx vsce publish`.

Cuando llegue el momento, se agrega a este mismo flujo.
