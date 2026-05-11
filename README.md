# 🎬 Filmaffinity Explorer

[![CI](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/ci.yml)
[![Daily Filmaffinity Sync](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/daily-sync.yml/badge.svg)](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/daily-sync.yml)
[![Deploy GitHub Pages](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/pages.yml/badge.svg)](https://github.com/rubencougil/filmaffinity-explorer/actions/workflows/pages.yml)

Web app to browse and analyze FilmAffinity ratings for one or more users.

## ✨ Features

- Biblioteca con búsqueda y filtros
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

## 🤖 Sync diario en GitHub Actions

Sí, también se puede automatizar una vez al día desde GitHub Actions.

Para que funcione, crea estos secrets:

- `FILMAFFINITY_CONFIG_JSON` con el contenido completo de tu `config.json`
- `FILMAFFINITY_PUSH_TOKEN` con un token que tenga permiso de escritura en este repositorio

El workflow `.github/workflows/daily-sync.yml`:

- instala las dependencias
- ejecuta el sync en modo headless
- commitea solo `public/data/libraries.json` de vuelta a `main`

Después, el workflow de GitHub Pages se encarga de desplegar la versión publicada a partir de ese commit.

Si Filmaffinity devuelve challenge, CAPTCHA o bloqueo temporal, el job falla con un mensaje claro en vez de intentar abrir una ventana visible.

## 🧪 Probar la versión estática en local

```bash
npm run serve:static
```

Abre la URL que te muestre `serve`.

## 🚀 Publicar en GitHub Pages

1. Ejecuta `npm run sync:static`.
2. Haz commit de los cambios (incluyendo `public/data/libraries.json`).
3. Push a `main`.
4. El workflow `.github/workflows/pages.yml` desplegará `public/` en Pages.

## 🧭 Rutas

- `index.html` → Biblioteca
- `watch-next.html` → Qué ver
- `affinity.html` → Afinidad
- `stats.html` → Estadísticas
- `sync.html` → Instrucciones de sync local

## 📦 Stack

- Vanilla HTML/CSS/JS
- Node.js + Playwright (solo para sync local)
