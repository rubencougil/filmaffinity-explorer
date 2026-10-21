# 🎬 Filmaffinity Explorer

[![CI](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/pages.yml/badge.svg)](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/pages.yml)

Web app to browse and analyze FilmAffinity ratings for one or more users.

## ✨ Features

- Biblioteca con búsqueda y filtros
- Búsqueda sin distinguir mayúsculas ni acentos y filtros compartibles mediante la URL
- Carga progresiva al hacer scroll en Biblioteca y Qué ver, sin botones de paginación
- Recomendaciones "Qué ver" por afinidad entre usuarios
- Vista de Afinidad y Estadísticas
- Modal de trailer (YouTube)
- Deploy estático en GitHub Pages

## ⚙️ Configuración

Crea `config.json` desde `config.example.json`:

```json
{
  "filmaffinity": {
    "defaultUser": "Usuario Principal",
    "users": [
      { "name": "Usuario Principal", "userId": "123456" },
      { "name": "Usuario Secundario", "userId": "654321" }
    ]
  }
}
```

## 🔄 Sync local (CLI)

La web publicada en GitHub Pages no tiene backend, así que el sync se hace en local:

```bash
npm install
npm run sync:static
```

Esto actualiza:

- `public/data/libraries.json`

La sincronización se ejecuta solo en local; no hay un workflow de sync en GitHub Actions.
Los errores al resolver trailers se muestran en la consola; los metadatos ya resueltos se conservan.

## 🧪 Probar la versión estática en local

```bash
npm run serve:static
```

Abre la URL que te muestre `serve`.
Este comando genera `dist/` con JavaScript, CSS y datos JSON minificados antes de servirlo.
`public/` sigue siendo el código fuente y los datos que se guardan en Git.

### Carga de datos en producción

El build genera un catálogo pequeño (`dist/data/catalog.json`), un archivo por
biblioteca y un índice compacto con las notas y fechas necesarias para comparar
usuarios. Los archivos de datos llevan un hash de contenido en el nombre.

Biblioteca, Estadísticas y Afinidad descargan la biblioteca seleccionada y el
índice de comparación, sin los posters ni trailers de las demás bibliotecas.
Qué ver necesita las bibliotecas completas de todos los usuarios para calcular
sus sugerencias. Las peticiones simultáneas comparten descarga y los datos
cargados se reutilizan al cambiar de usuario dentro de la página.

El formato de `public/data/libraries.json` y el comando de sync no cambian.
Se conserva una copia minificada de ese archivo en `dist/` para las páginas de
despliegues anteriores que sigan abiertas o en caché. Si un despliegue sustituye
un archivo que una página todavía espera, se vuelve a consultar el catálogo y
se reintenta una sola vez; los errores restantes se muestran, no se sustituyen
por bibliotecas vacías.

Con los datos actuales, el JSON comprimido necesario para Biblioteca, Estadísticas
y Afinidad pasa de unos 204 kB a 93 kB para el usuario predeterminado
(aproximadamente un 55% menos). Según el usuario, la reducción es del 32–80%.
Son tamaños gzip de los datos, no una medición del tiempo total de carga ni una
garantía sobre la compresión del alojamiento.

## 🚀 Publicar en GitHub Pages

1. Ejecuta `npm run sync:static`.
2. Haz commit de los cambios (incluyendo `public/data/libraries.json`).
3. Push a `main`.
4. El workflow `.github/workflows/pages.yml` construirá y desplegará `dist/` en Pages.

## Comprobaciones

Usa Node.js 24 y ejecuta:

```bash
npm run lint
npm run check
npm test
```

Los tests incluyen las cinco rutas estáticas, el build de producción, errores de carga,
datos sin nota, recomendaciones y trailers, navegación móvil, cambio de usuario y carga progresiva.
También comprueban los archivos de datos generados, la equivalencia de la API
estática, las descargas por vista y la recuperación tras fallos o cambios de despliegue.
Para instalar Chromium por primera vez: `npx playwright install chromium`.

Para medir Lighthouse, inicia `npm run serve:static` y usa la URL que muestre:

```bash
npx lighthouse http://localhost:3000/index.html --output=html --output=json --output-path=/tmp/lighthouse-mobile
npx lighthouse http://localhost:3000/index.html --preset=desktop --output=html --output=json --output-path=/tmp/lighthouse-desktop
```

Repite para `watch-next.html`, `affinity.html`, `stats.html` y `sync.html`.
El sitio mantiene intencionadamente `noindex` y las reglas de `robots.txt`: el aviso SEO
de indexación no debe corregirse habilitando el rastreo. La latencia de los posters depende
del proxy externo; la compresión y la caché HTTP dependen del alojamiento.

## 🧭 Rutas

- `index.html` → Biblioteca
- `watch-next.html` → Qué ver
- `affinity.html` → Afinidad
- `stats.html` → Estadísticas
- `sync.html` → Instrucciones de sync local

### Búsquedas y filtros

Biblioteca y Qué ver guardan la búsqueda y los filtros en la URL para compartirlos,
marcarlos como favoritos o recuperarlos al recargar. Por ejemplo:
`index.html?userName=Usuario&q=amelie&year=2001&minRating=8`.
Biblioteca permite repetir `year` para seleccionar varios años. Los valores no
válidos se descartan y los filtros predeterminados se omiten de la URL.

«Limpiar filtros» borra la búsqueda y las restricciones sin cambiar de usuario.
En Qué ver también permite sugerencias con el apoyo de un solo usuario; la vista
inicial sigue exigiendo dos. Los estados vacíos distinguen entre filtros sin
coincidencias y falta de datos, y ofrecen limpiar los filtros cuando hay títulos
disponibles. Las notas mínimas seleccionadas se respetan incluso si la biblioteca
no contiene notas personales.

### Navegación y preferencias

Las cuatro vistas de datos comparten la selección de usuario: tiene prioridad el
usuario de la URL, después la preferencia guardada, el usuario predeterminado de la
configuración y finalmente el primer usuario disponible. Los enlaces del menú y
la marca conservan el usuario activo. Cambiar de usuario no borra los filtros de la
URL ni los parámetros ajenos a esa selección; Afinidad conserva el usuario de
comparación mientras siga siendo válido.

Si el navegador bloquea las preferencias locales o no permite guardarlas por falta
de espacio, la aplicación sigue funcionando y conserva la selección mediante la
URL. Se muestra un aviso en la consola, en lugar de impedir cargar la biblioteca.

En las cinco páginas, el primer Tab muestra «Saltar al contenido principal».
Activarlo lleva el foco al contenido sin recorrer la cabecera; el menú identifica
la vista actual con `aria-current="page"`.

### Recuperación de errores de carga

Si falla la configuración o una biblioteca, las cuatro vistas de datos muestran
el error y un botón «Reintentar». La recuperación no recarga la página ni borra el
usuario, los filtros o la comparación seleccionada. El botón también funciona con
teclado y mantiene el foco en el estado de carga, sin devolverlo a la cabecera.
Los errores persistentes siguen mostrándose y permiten volver a intentarlo.

Al cambiar de usuario, solo la petición más reciente puede actualizar la vista o
mostrar un error, incluso al volver rápidamente al usuario anterior. En Afinidad
se puede elegir otra comparación durante la carga sin mostrar datos del usuario
anterior; se aplica cuando termina la petición actual.

### Entender las recomendaciones

En Qué ver, «¿Por qué aparecen estas películas?» explica qué usuarios y votos se
utilizan. La nota estimada es una media ponderada por afinidad y cantidad de títulos
compartidos: no es una valoración del usuario ni una probabilidad de acierto.
Las tarjetas distinguen esa estimación de la nota media real de quienes recomiendan
el título y muestran el número medio de títulos que tienen en común contigo.
Los cálculos, los valores de los filtros y el orden predeterminado por año no cambian.

## 📦 Stack

- Vanilla HTML/CSS/JS
- Node.js para build y sync local; Playwright para sync y tests de navegador

`public/site-utils.js` centraliza la selección de usuario y sus enlaces, los filtros
compartibles, posters, estados vacíos, recuperación de errores, control de peticiones
obsoletas y el diálogo de tráiler.
`public/theme.js` comparte el menú móvil y el control de
filtros, incluido el cierre con Escape. Los diálogos usan `<dialog>` nativo para
conservar el foco y muestran un mensaje local cuando no hay vídeo disponible,
sin generar una página HTML dentro del iframe.
El reproductor incrustado gestiona sus propias teclas; para cerrar con Escape
desde él, usa Mayús+Tab hasta volver al botón de cierre.

Los estilos se mantienen en `public/styles.css`, organizados por componentes y
con los breakpoints al final. Los colores usan variables `--fa-*`; la preferencia
de movimiento reducido se respeta tanto en móvil como en escritorio.
