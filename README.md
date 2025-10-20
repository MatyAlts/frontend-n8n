# frontend-n8n

Interfaz web para generar rúbricas JSON a partir de exámenes en PDF y corregir entregas utilizando flujos de trabajo en n8n.

## Requisitos previos

- Node.js 18 o superior
- pnpm, npm o yarn (los ejemplos utilizan `npm`)
- Dos webhooks expuestos por n8n:
  - Uno que recibe un PDF (`file` o `pdf`) y devuelve la rúbrica en formato JSON.
  - Otro que recibe una rúbrica JSON (`rubric`) y el archivo a corregir (`submission`) y devuelve el resultado de la corrección.

## Configuración

1. Copia el archivo `.env.example` y renómbralo a `.env`.
2. Sustituye las URLs de los webhooks por las de tu instancia de n8n.

```bash
cp .env.example .env
```

## Scripts disponibles

Instala las dependencias y ejecuta los scripts con `npm`:

```bash
npm install
npm run dev
```

- `npm run dev`: inicia el entorno de desarrollo de Vite.
- `npm run build`: genera la versión optimizada de producción.
- `npm run preview`: sirve la build de producción.

## Flujo de uso

1. **Generar rúbrica**: selecciona un PDF (parcial, final o TP) y pulsa "Convertir a rúbrica". El archivo se envía al webhook configurado y el JSON devuelto se muestra en pantalla.
2. **Importar rúbrica existente**: si ya tienes una rúbrica en JSON, impórtala para usarla directamente.
3. **Corregir entregas**: selecciona el archivo a corregir (Python, Java, Word, PDF, etc.) y pulsa "Corregir". Se enviará el archivo junto con la rúbrica al webhook de corrección y el resultado aparecerá en la sección de resultados.

Los errores devueltos por los webhooks se muestran en la interfaz para facilitar el diagnóstico.

## Personalización

- Los estilos se encuentran en `src/styles.css` y pueden ajustarse para adaptarse a la identidad visual de tu institución.
- Si tu webhook espera otros nombres de campos, actualiza `src/App.tsx` en las secciones `formData.append(...)`.

## Licencia

Este proyecto se publica sin licencia específica. Ajusta o agrega una licencia según tus necesidades.
