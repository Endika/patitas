# Patitas

Patitas es un juego para el móvil, instalable como PWA, en el que adoptas cachorros, juegas con ellos y los cuidas. Está hecho con React, Vite, TypeScript y three.js.

## Desarrollo

```sh
npm install
npm run dev          # servidor de desarrollo
npm run format:check # comprobar el formato
npm run lint         # eslint, sin avisos permitidos
npm run type:check   # tipos de la app y de los tests
npm run test:run     # tests
npm run build        # compilación de producción
npm run icons        # regenerar los iconos PNG desde public/favicon.svg
```

## Rendimiento

Objetivo: 50 fps o más con 2 cachorros en el OnePlus 8.

Para medir, abre la app con `?fps` en la URL (por ejemplo `https://endika.github.io/patitas/?fps`): la sala muestra los fps en una esquina, actualizados dos veces por segundo.

Calidad según el dispositivo (`pickQuality`):

| Dispositivo         | Pelos (`shells`) | `dpr` máx. | Sombra |
| ------------------- | ---------------- | ---------- | ------ |
| Ordenador           | 24               | 2          | 2048   |
| Táctil, 1 cachorro  | 16               | 1,6        | 2048   |
| Táctil, 2 cachorros | 12               | 1,5        | 1024   |

Medición en el móvil: pendiente
