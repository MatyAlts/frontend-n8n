import { ChangeEvent, useMemo, useState } from 'react';

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return typeof value === 'string' ? value : '';
  }
};

const parseJsonSafely = (text: string) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
};

const downloadFile = (content: string, filename: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const extractIframeContent = (text: string): string => {
  // Buscar contenido dentro de iframe srcdoc
  const iframeMatch = text.match(/<iframe[^>]*srcdoc=["']([^"']*)["'][^>]*>/i);
  if (iframeMatch && iframeMatch[1]) {
    // Extraer el contenido y procesar escapes HTML
    let content = iframeMatch[1];
    // Reemplazar escapes HTML comunes
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&lt;/g, '<');
    content = content.replace(/&gt;/g, '>');
    content = content.replace(/&amp;/g, '&');
    // Convertir \n en saltos de línea reales
    content = content.replace(/\\n/g, '\n');
    return content;
  }
  // Si no hay iframe, convertir \n de todas formas
  return text.replace(/\\n/g, '\n');
};

type RubricSource = 'generada' | 'importada' | null;

type WebhookError = {
  message: string;
  details?: string;
};

const App = () => {
  const rubricWebhookUrl = import.meta.env.VITE_RUBRIC_WEBHOOK_URL ?? '';
  const gradingWebhookUrl = import.meta.env.VITE_GRADING_WEBHOOK_URL ?? '';

  const [rubricPdf, setRubricPdf] = useState<File | null>(null);
  const [rubricJson, setRubricJson] = useState<string>('');
  const [rubricSource, setRubricSource] = useState<RubricSource>(null);
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);

  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [isGrading, setIsGrading] = useState(false);

  const [gradingResponse, setGradingResponse] = useState<unknown>(null);

  const [rubricError, setRubricError] = useState<WebhookError | null>(null);
  const [gradingError, setGradingError] = useState<WebhookError | null>(null);

  const hasRubric = rubricJson.trim().length > 0;

  const handleRubricPdfChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    setRubricPdf(file ?? null);
  };

  const handleRubricImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseJsonSafely(text);
      if (!parsed) {
        throw new Error('El archivo no contiene un JSON válido.');
      }
      const pretty = JSON.stringify(parsed, null, 2);
      setRubricJson(pretty);
      setRubricSource('importada');
      setRubricError(null);
    } catch (error) {
      setRubricError({
        message: error instanceof Error ? error.message : 'No se pudo leer la rúbrica JSON.',
      });
    }
  };

  const handleRubricDownload = () => {
    if (!hasRubric) {
      return;
    }
    downloadFile(rubricJson, 'rubrica.json', 'application/json');
  };

  const handleSubmissionChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    setSubmissionFile(file ?? null);
  };

  const sendWebhookRequest = async (url: string, body: FormData) => {
    const response = await fetch(url, {
      method: 'POST',
      body,
    });

    const responseText = await response.text();

    if (!response.ok) {
      let details: string | undefined;
      const parsed = parseJsonSafely(responseText);
      if (parsed) {
        details = formatJson(parsed);
      } else {
        details = responseText;
      }
      throw {
        message: `Error ${response.status}: ${response.statusText || 'al invocar el webhook'}`,
        details,
      } satisfies WebhookError;
    }

    const parsed = parseJsonSafely(responseText);
    return parsed ?? responseText;
  };

  const handleGenerateRubric = async () => {
    if (!rubricPdf) {
      setRubricError({ message: 'Selecciona un archivo PDF antes de generar la rúbrica.' });
      return;
    }
    if (!rubricWebhookUrl) {
      setRubricError({
        message: 'Configura la variable VITE_RUBRIC_WEBHOOK_URL en tu archivo .env.',
      });
      return;
    }

    setIsGeneratingRubric(true);
    setRubricError(null);

    try {
      const formData = new FormData();
      formData.append('pdf', rubricPdf);
      const result = await sendWebhookRequest(rubricWebhookUrl, formData);
      // Procesar el resultado para extraer contenido de iframe si existe
      const processedResult = typeof result === 'string' ? extractIframeContent(result) : result;
      const printable = typeof processedResult === 'string' ? processedResult : formatJson(processedResult);
      setRubricJson(printable);
      setRubricSource('generada');
    } catch (error) {
      const webhookError = error as WebhookError;
      setRubricError(webhookError);
    } finally {
      setIsGeneratingRubric(false);
    }
  };

  const handleGradeSubmission = async () => {
    if (!hasRubric) {
      setGradingError({
        message: 'Necesitas generar o importar una rúbrica JSON antes de corregir.',
      });
      return;
    }

    if (!submissionFile) {
      setGradingError({ message: 'Selecciona un archivo para corregir.' });
      return;
    }

    if (!gradingWebhookUrl) {
      setGradingError({
        message: 'Configura la variable VITE_GRADING_WEBHOOK_URL en tu archivo .env.',
      });
      return;
    }

    setIsGrading(true);
    setGradingError(null);
    setGradingResponse(null);

    try {
      const formData = new FormData();
      const rubricBlob = new Blob([rubricJson], { type: 'application/json' });
      formData.append('rubric', rubricBlob, 'rubrica.json');
      formData.append('submission', submissionFile);
      const result = await sendWebhookRequest(gradingWebhookUrl, formData);
      // Procesar el resultado para extraer contenido de iframe si existe
      const processedResult = typeof result === 'string' ? extractIframeContent(result) : result;
      setGradingResponse(processedResult);
    } catch (error) {
      const webhookError = error as WebhookError;
      setGradingError(webhookError);
    } finally {
      setIsGrading(false);
    }
  };

  const rubricTitle = useMemo(() => {
    if (!hasRubric || !rubricSource) {
      return 'Rúbrica JSON';
    }
    return `Rúbrica JSON (${rubricSource})`;
  }, [hasRubric, rubricSource]);

  return (
    <div className="app">
      <header className="hero">
        <h1>Generador y Corrector de Rúbricas</h1>
        <p>
          Automatiza la generación de rúbricas desde archivos PDF y corrige entregas usando tus flujos de
          n8n.
        </p>
      </header>

      <main className="content">
        <section className="card">
          <h2>1. Generar rúbrica desde PDF</h2>
          <p>Sube un examen parcial, final o trabajo práctico en PDF para convertirlo en una rúbrica JSON.</p>
          <div className="field-group">
            <label className="field">
              <span>Archivo PDF</span>
              <input type="file" accept="application/pdf" onChange={handleRubricPdfChange} />
            </label>
            <button
              type="button"
              className="primary"
              onClick={handleGenerateRubric}
              disabled={isGeneratingRubric}
            >
              {isGeneratingRubric ? 'Generando…' : 'Convertir a rúbrica'}
            </button>
          </div>
          <p className="hint">
            El archivo se enviará al webhook configurado y la respuesta mostrará el JSON resultante.
          </p>
          {rubricError && (
            <div className="alert error">
              <strong>{rubricError.message}</strong>
              {rubricError.details && <pre>{rubricError.details}</pre>}
            </div>
          )}
        </section>

        <section className="card">
          <h2>2. Importar rúbrica existente</h2>
          <p>Si ya cuentas con una rúbrica JSON, impórtala para utilizarla en una corrección.</p>
          <div className="field">
            <span>Archivo JSON</span>
            <input type="file" accept="application/json" onChange={handleRubricImport} />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>{rubricTitle}</h2>
            <div className="actions">
              <button type="button" onClick={handleRubricDownload} disabled={!hasRubric}>
                Descargar JSON
              </button>
            </div>
          </div>
          {hasRubric ? (
            <pre className="code-block">{rubricJson}</pre>
          ) : (
            <p className="hint">Genera o importa una rúbrica para visualizarla aquí.</p>
          )}
        </section>

        <section className="card">
          <h2>3. Corregir con rúbrica</h2>
          <p>Envía tu rúbrica JSON junto con el archivo a evaluar para obtener la nota final.</p>
          <div className="field-group">
            <label className="field">
              <span>Archivo a corregir</span>
              <input type="file" onChange={handleSubmissionChange} />
            </label>
            <button
              type="button"
              className="primary"
              onClick={handleGradeSubmission}
              disabled={isGrading}
            >
              {isGrading ? 'Corrigiendo…' : 'Corregir'}
            </button>
          </div>
          <p className="hint">
            Debes contar con una rúbrica JSON (generada o importada) y un archivo a corregir para habilitar la
            corrección.
          </p>
          {gradingError && (
            <div className="alert error">
              <strong>{gradingError.message}</strong>
              {gradingError.details && <pre>{gradingError.details}</pre>}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Resultado de la corrección</h2>
          {gradingResponse ? (
            <div className="result-block">{typeof gradingResponse === 'string' ? gradingResponse : formatJson(gradingResponse)}</div>
          ) : (
            <p className="hint">La respuesta del webhook de corrección aparecerá aquí.</p>
          )}
        </section>
      </main>

      <footer className="footer">
        <small>
          Configura las URLs de los webhooks con las variables <code>VITE_RUBRIC_WEBHOOK_URL</code> y{' '}
          <code>VITE_GRADING_WEBHOOK_URL</code> en un archivo <code>.env</code>.
        </small>
      </footer>
    </div>
  );
};

export default App;
