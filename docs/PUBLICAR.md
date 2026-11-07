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

## 4. Publicar en el Marketplace

Con el Marketplace, la gente instala buscando "Ramcrack Request" y VS Code **actualiza la extensión solo**. Además desaparecen los avisos del navegador al descargar el `.vsix`.

> **Los tokens personales (PAT) de Azure DevOps se retiran el 1 de diciembre de 2026.** Por eso esta guía no los usa: el primer lanzamiento se sube a mano y las siguientes versiones se publican con *Trusted Publishing* (sin guardar ningún secreto).

Referencia oficial: https://code.visualstudio.com/api/working-with-extensions/publishing-extension

**Estado:** la versión 0.2.0 ya está publicada en el Marketplace (primera publicación, a mano). Las siguientes se pueden publicar con el Paso 4.

### Antes de publicar (ya está hecho en el proyecto)
- Icono PNG de 256×256 en `media/icon.png`, referenciado en `package.json` (`icon`). El Marketplace no acepta SVG.
- `repository`, `LICENSE`, `README.md` y `CHANGELOG.md`.
- Versión: Microsoft recomienda versiones con minor **par** para lanzamientos normales (`0.2.x`) y minor impar para pre-lanzamientos. La primera versión del Marketplace será **0.2.0**.

### Paso 1: Crear el publisher (una sola vez)
1. Entra a https://marketplace.visualstudio.com/manage e inicia sesión con una cuenta Microsoft.
2. Pulsa **Create publisher**.
3. **ID:** `ramcrack` (debe coincidir **exactamente** con el campo `publisher` de `package.json` y **no se puede cambiar** después). **Name:** `Ramcrack`.
4. Si el ID ya está en uso, elige otro y avísame para cambiar `publisher` en `package.json`.

### Paso 2: Preparar la versión 0.2.0
Con todo lo anterior subido a `main`, y una sección `## 0.2.0` en `CHANGELOG.md`:
```bash
npm version minor
git push
git push --tags
```
`npm version minor` pasa de 0.1.3 a 0.2.0, hace el commit y crea la etiqueta `v0.2.0`. El flujo "Publicar versión" crea el Release de GitHub con el `.vsix`.

### Paso 3: Primera publicación, a mano (la más sencilla)
1. Descarga `ramcrack-request-0.2.0.vsix` desde el Release de GitHub (o genéralo con `npm run package`).
2. En https://marketplace.visualstudio.com/manage abre tu publisher, pulsa la **flecha ▾** del botón **New extension** y elige **Visual Studio Code** → sube el `.vsix`.
   > **Importante:** la página debe llamarse "Upload Visual Studio **Code** extension". Si entras por la opción de *Visual Studio* (el programa para Windows), el Marketplace responde con `Value cannot be null. Parameter name: v1`, aunque el paquete esté bien.
3. El Marketplace valida el archivo y lo analiza en busca de malware. Tarda unos minutos. Cuando termine, la extensión aparece en `https://marketplace.visualstudio.com/items?itemName=ramcrack.ramcrack-request`.

> Si el análisis rechaza el archivo por la misma detección falsa de Defender (`Trojan:Script/Ulthar.A!ml`), reporta el falso positivo a Microsoft (https://www.microsoft.com/en-us/wdsi/filesubmission, "Software developer") y vuelve a subirlo.

### Paso 4: Publicaciones siguientes, automáticas (Trusted Publishing)
Una vez publicada la primera versión:
1. En la página de tu publisher, abre **Trusted Publishing** y crea una política con:
   - Propietario del repositorio: `Dhaniel-05`
   - Repositorio: `Ramcrack_Request`
   - Archivo del flujo: `publish-marketplace.yml`
2. Para cada versión nueva: `npm version patch` (o `minor`), `git push`, `git push --tags`. Cuando termine el flujo "Publicar versión", ve a **Actions → Publicar en el Marketplace → Run workflow**, y en *Use workflow from* elige la etiqueta (por ejemplo `v0.2.1`).
3. El flujo compila, prueba, empaqueta y publica con `vsce publish --oidc`, sin ningún token guardado.

El flujo `publish-marketplace.yml` ya está en el proyecto y solo se ejecuta a mano, para que nunca se publique algo por accidente.

### Después de publicar
- Quien tenga la extensión instalada desde un `.vsix` debe **desinstalarla antes** (`code --uninstall-extension ramcrack.ramcrack-request`) e instalarla desde el Marketplace. El identificador es el mismo, así que no habrá duplicados.
- Añade capturas de pantalla al `README.md` con enlaces `https://` (el Marketplace no admite imágenes locales). Mejoran mucho la página de la extensión.
- Para el aviso de "editor verificado" hacen falta 6 meses de antigüedad y un dominio propio; no es un requisito para publicar.

### Patrocinio
El patrocinio está enlazado en dos sitios, y no requiere ningún paso al publicar:
- `.github/FUNDING.yml` muestra el botón **Sponsor** en el repositorio de GitHub.
- El campo `sponsor` de `package.json` pone un enlace de patrocinio en la página del Marketplace.
