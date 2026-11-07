# Instalar Ramcrack Request (guía para estudiantes)

Esta guía te lleva paso a paso, desde descargar la extensión de GitHub hasta tenerla funcionando en Visual Studio Code. Son unos 5 minutos.

> **Qué es Ramcrack Request:** un cliente para probar APIs (peticiones HTTP, colecciones, entornos y tests) dentro de VS Code. El código es público en https://github.com/Dhaniel-05/Ramcrack_Request

---

> **Recomendado: instálala desde el Marketplace de VS Code.** Es más simple y no necesita esta guía: abre **Extensiones** (`Ctrl+Shift+X`), busca **Ramcrack Request** y pulsa **Instalar**, o ejecuta `code --install-extension ramcrack.ramcrack-request`. Esta guía es el **plan B**, para cuando no puedas usar el Marketplace (por ejemplo, equipos sin acceso a él) o si prefieres instalar un archivo concreto.

## Antes de empezar

| Necesitas | Cómo comprobarlo |
|---|---|
| Windows 10 u 11 | — |
| Visual Studio Code 1.85 o superior | Abre una terminal y escribe `code --version` |
| Conexión a internet | — |

**Importante: léelo antes de seguir.** Windows Defender (el antivirus de Windows) puede marcar un archivo de esta extensión como "troyano" (`Trojan:Script/Ulthar.A!ml`). Es un **falso positivo**: la extensión es nueva, no tiene firma digital y Defender la clasifica por reputación. El código se puede revisar en GitHub. Si Defender borra ese archivo, la extensión no arranca y los botones no hacen nada.

Por eso, en esta guía **primero le decimos a Defender que ignore la carpeta de la extensión** y después la instalamos. Solo se excluye esa carpeta, no todo el disco.

---

## Paso 1: Abrir PowerShell como administrador

1. Pulsa la tecla **Windows**.
2. Escribe `PowerShell`.
3. Haz **clic derecho** sobre *Windows PowerShell* y elige **Ejecutar como administrador**.
4. Si Windows pregunta "¿Permitir que esta aplicación haga cambios?", pulsa **Sí**.

La ventana debe ser azul y su título debe decir **Administrador: Windows PowerShell**.

> Los pasos siguientes se ejecutan **en esa misma ventana**. Copia un bloque, pégalo con clic derecho, pulsa **Enter** y espera a que termine antes de seguir con el siguiente.

---

## Paso 2: Elegir la versión

Esta es la versión que vas a instalar. Si tu profesor te indica otra, cámbiala aquí:

```powershell
$version = "0.1.3"
```

Este valor se usa en todos los pasos siguientes, así que **no cierres la ventana** hasta terminar. Si la cierras, repite este paso.

---

## Paso 3: Excluir la carpeta de la extensión en Defender

Esto **debe hacerse antes de instalar**. Si instalas primero, Defender puede borrar un archivo y habría que repetir todo.

```powershell
$carpetaExtension = "$env:USERPROFILE\.vscode\extensions\ramcrack.ramcrack-request-$version"
Add-MpPreference -ExclusionPath $carpetaExtension
```

Comprueba que quedó registrada. Debe aparecer tu carpeta en la lista:

```powershell
Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
```

Deberías ver una línea parecida a:

```text
C:\Users\TU_USUARIO\.vscode\extensions\ramcrack.ramcrack-request-0.1.3
```

### Alternativa con la interfaz gráfica
Si prefieres hacerlo con el ratón:
1. Abre **Seguridad de Windows** → **Protección antivirus y contra amenazas**.
2. En *Configuración de antivirus y protección contra amenazas*, pulsa **Administrar la configuración**.
3. Baja hasta **Exclusiones** → **Agregar o quitar exclusiones**.
4. Pulsa **Agregar una exclusión** → **Carpeta**.
5. Escribe o pega la ruta `C:\Users\TU_USUARIO\.vscode\extensions\ramcrack.ramcrack-request-0.1.3` (cambia `TU_USUARIO` por tu usuario de Windows). Si la carpeta aún no existe, créala vacía primero, o usa el comando de PowerShell de arriba, que no lo necesita.

---

## Paso 4: Descargar el instalador desde GitHub

Se descarga con PowerShell y no con el navegador, porque Chrome suele bloquear este tipo de archivo con el aviso "Virus detectado".

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$archivo = "$env:USERPROFILE\Downloads\ramcrack-request-$version.vsix"
Invoke-WebRequest "https://github.com/Dhaniel-05/Ramcrack_Request/releases/download/v$version/ramcrack-request-$version.vsix" -OutFile $archivo
```

El archivo queda en tu carpeta **Descargas**.

> También se puede descargar a mano desde https://github.com/Dhaniel-05/Ramcrack_Request/releases, en la sección **Assets**, haciendo clic en el archivo `.vsix`. Pero si el navegador lo bloquea, usa los comandos de arriba.

---

## Paso 5: Verificar que el archivo es el original

Este paso comprueba que nadie modificó el archivo. Compara el archivo que descargaste con el que GitHub registró:

```powershell
$esperado = ((Invoke-RestMethod "https://api.github.com/repos/Dhaniel-05/Ramcrack_Request/releases/tags/v$version").assets | Where-Object { $_.name -like "*.vsix" }).digest -replace "^sha256:", ""
$real = (Get-FileHash $archivo -Algorithm SHA256).Hash
if ($real -eq $esperado) { "OK: el archivo es el original" } else { "ERROR: el archivo NO coincide. No lo instales y avisa a tu profesor." }
```

Debe responder: **`OK: el archivo es el original`**.

Si dice ERROR, **no continúes**: borra el archivo, vuelve al Paso 4, y si se repite avisa a tu profesor.

---

## Paso 6: Instalar la extensión

```powershell
code --install-extension $archivo --force
```

Debe terminar con:

```text
Extension 'ramcrack-request-0.1.3.vsix' was successfully installed.
```

El aviso `DeprecationWarning ... url.parse()` que sale después es de VS Code y **no es un error**.

Comprueba que se instalaron todos los archivos (en esta versión deben ser **10**):

```powershell
(Get-ChildItem "$carpetaExtension\out" -Filter *.js).Count
```

Si sale un número menor que 10, Defender borró algún archivo: revisa el Paso 3 y repite desde el Paso 6.

---

## Paso 7: Reiniciar VS Code y comprobar

1. **Cierra VS Code por completo** (todas las ventanas) y vuelve a abrirlo. No basta con recargar la ventana.
2. En la barra lateral izquierda debe aparecer un **icono de matraz** de laboratorio.
3. Abajo a la izquierda debe verse el texto **`Ramcrack: sin entorno`**.

Si ves las dos cosas, la extensión está funcionando.

---

## Paso 8: Probar que funciona

1. Haz clic en el icono del matraz.
2. Pulsa **Nueva petición**.
3. Escribe en la barra de dirección: `https://httpbin.org/get`
4. Pulsa **Enviar** (o `Ctrl+Enter`).

A la derecha debe aparecer **Estado: 200 OK** y un JSON con colores. Listo, ya puedes usarla.

---

## Si algo no funciona

| Problema | Qué hacer |
|---|---|
| `code` no se reconoce como comando | VS Code no está en el PATH. Instala la extensión desde VS Code: `Ctrl+Shift+X` → menú `···` → **Instalar desde VSIX…** y elige el archivo de **Descargas**. |
| Los botones no hacen nada o sale `command 'apiRequest...' not found` | Defender borró un archivo. Revisa el **Historial de protección** (Seguridad de Windows). Haz el Paso 3 y repite desde el Paso 6. |
| En *Show Running Extensions* se queda en "Activating…" | Mismo caso: comprueba el conteo de archivos del Paso 6. |
| `Add-MpPreference` no se reconoce o da error de acceso | La ventana no es de administrador (repite el Paso 1) o tu equipo usa otro antivirus. En ese caso agrega la exclusión en su configuración. |
| Windows te pidió la contraseña de **otro** usuario administrador | Las rutas apuntan al perfil equivocado. Usa dos ventanas: la de administrador solo para el Paso 3 (cambia `$env:USERPROFILE` por `C:\Users\TU_USUARIO`) y una PowerShell normal para los demás. |
| Sale `ERROR: el archivo NO coincide` | No lo instales. Borra el archivo y vuelve a descargarlo. Si sigue igual, avisa a tu profesor. |
| Defender sigue marcando archivos | Revisa que la ruta de la exclusión sea **exacta** (con tu usuario y la versión). Que coincida con la carpeta que ve `Get-MpPreference`. |

Para ver los mensajes de la extensión: **Ver → Salida** y elige **Ramcrack Request** en el desplegable.

---

## Actualizar a una versión nueva

Las extensiones instaladas con un archivo `.vsix` **no se actualizan solas**. Cuando tu profesor avise de una versión nueva:

1. Abre PowerShell como administrador (Paso 1).
2. Cambia el número en el Paso 2 (`$version = "0.1.4"`, por ejemplo).
3. Repite los Pasos 3 a 7. **El Paso 3 es obligatorio otra vez**, porque cada versión se instala en una carpeta distinta.

---

## Desinstalar y quitar la exclusión

```powershell
code --uninstall-extension ramcrack.ramcrack-request
Remove-MpPreference -ExclusionPath "$env:USERPROFILE\.vscode\extensions\ramcrack.ramcrack-request-$version"
```

---

## Sobre la seguridad

- La exclusión solo afecta a **una carpeta** (la de esta extensión), no a tu equipo entero. Mantén siempre activada la protección en tiempo real de Windows.
- El instalador lo compila **GitHub automáticamente** desde el código público del repositorio. El Paso 5 demuestra que tu archivo es exactamente ese.
- No excluyas carpetas más grandes (como `C:\` o `Descargas`) para resolver este problema.
- La extensión solo envía las peticiones que **tú** escribes, a las direcciones que **tú** indicas. No envía datos a ningún otro sitio.
