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
  const iframeMatch = text.match(/<iframe[^>]*srcdoc=["']([^"']*)["'][^>]*>/i);
  if (iframeMatch && iframeMatch[1]) {
    let content = iframeMatch[1];
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&lt;/g, '<');
    content = content.replace(/&gt;/g, '>');
    content = content.replace(/&amp;/g, '&');
    content = content.replace(/\\n/g, '\n');
    return content;
  }
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
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-y-0 -left-20 hidden w-[28rem] rounded-full bg-sky-500/25 blur-3xl lg:block" />
        <div className="absolute top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute bottom-10 right-0 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl" />
      </div>

      <div className="relative backdrop-aurora">
        <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-16 pt-12 sm:px-6 lg:px-10">
          <header className="relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/70 p-10 text-center shadow-card transition duration-500 hover:border-sky-400/60">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/20 via-purple-500/10 to-transparent" />
            <div className="relative space-y-4 motion-safe:animate-float">
              <span className="inline-flex items-center justify-center rounded-full border border-sky-400/40 bg-sky-400/10 px-4 py-1 text-sm font-semibold uppercase tracking-[0.3em] text-sky-200/80">
                Automatiza tus evaluaciones
              </span>
              <h1 className="text-3xl font-semibold text-slate-50 sm:text-4xl">
                Generador y Corrector de Rúbricas
              </h1>
              <p className="mx-auto max-w-2xl text-base text-slate-300 sm:text-lg">
                Convierte tus PDFs en rúbricas inteligentes y corrige entregas en segundos con tus flujos de n8n.
              </p>
            </div>
          </header>

          <main className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
            <div className="flex flex-col gap-8">
              <section className="group relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-card transition duration-500 hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_35px_90px_rgba(56,189,248,0.25)]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-300 ring-1 ring-inset ring-sky-400/40">
                      1
                    </span>
                    <h2 className="text-xl font-semibold text-slate-100">Generar rúbrica desde PDF</h2>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">
                    Carga un examen parcial, final o trabajo práctico en PDF para transformarlo en una rúbrica JSON editable.
                  </p>
                  <div className="flex flex-col gap-4 md:flex-row md:items-end">
                    <label className="flex w-full flex-col gap-2 text-sm font-medium text-slate-200">
                      Archivo PDF
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleRubricPdfChange}
                        className="block w-full cursor-pointer rounded-2xl border border-slate-800/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 shadow-inner transition focus:border-sky-400/70 focus:outline-none focus:ring-2 focus:ring-sky-500/40 file:mr-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-sky-400 file:to-indigo-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:file:brightness-110"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRubric}
                      disabled={isGeneratingRubric}
                      className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-sky-400 via-indigo-500 to-purple-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_25px_60px_rgba(56,189,248,0.35)] transition focus:outline-none focus:ring-2 focus:ring-sky-400/70 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGeneratingRubric ? 'Generando…' : 'Convertir a rúbrica'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    El archivo se enviará al webhook configurado y la respuesta mostrará el JSON resultante.
                  </p>
                  {rubricError && (
                    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100 shadow-inner">
                      <strong className="block text-rose-100">{rubricError.message}</strong>
                      {rubricError.details && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-rose-100/90">{rubricError.details}</pre>}
                    </div>
                  )}
                </div>
              </section>

              <section className="group relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-card transition duration-500 hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_35px_90px_rgba(56,189,248,0.25)]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/40">
                      2
                    </span>
                    <h2 className="text-xl font-semibold text-slate-100">Importar rúbrica existente</h2>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">
                    Si ya dispones de una rúbrica JSON, impórtala y úsala de inmediato en tus correcciones.
                  </p>
                  <label className="flex w-full flex-col gap-2 text-sm font-medium text-slate-200">
                    Archivo JSON
                    <input
                      type="file"
                      accept="application/json"
                      onChange={handleRubricImport}
                      className="block w-full cursor-pointer rounded-2xl border border-slate-800/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 shadow-inner transition focus:border-indigo-400/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 file:mr-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-indigo-400 file:to-purple-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:file:brightness-110"
                    />
                  </label>
                </div>
              </section>

              <section className="group relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-card transition duration-500 hover:-translate-y-1 hover:border-emerald-400/60 hover:shadow-[0_35px_90px_rgba(16,185,129,0.25)]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold text-slate-100">{rubricTitle}</h2>
                    <button
                      type="button"
                      onClick={handleRubricDownload}
                      disabled={!hasRubric}
                      className="inline-flex items-center justify-center rounded-2xl border border-emerald-400/60 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Descargar JSON
                    </button>
                  </div>
                  {hasRubric ? (
                    <pre className="code-scrollbar max-h-[440px] overflow-auto rounded-2xl border border-slate-800/60 bg-slate-950/70 p-4 text-sm leading-relaxed text-sky-200 shadow-inner">
                      {rubricJson}
                    </pre>
                  ) : (
                    <p className="text-sm text-slate-400">Genera o importa una rúbrica para visualizarla aquí.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-8">
              <section className="group relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-card transition duration-500 hover:-translate-y-1 hover:border-purple-400/60 hover:shadow-[0_35px_90px_rgba(168,85,247,0.25)]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-300 ring-1 ring-inset ring-purple-400/40">
                      3
                    </span>
                    <h2 className="text-xl font-semibold text-slate-100">Corregir con rúbrica</h2>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">
                    Envía tu rúbrica JSON junto con el archivo a evaluar para obtener la nota final en segundos.
                  </p>
                  <div className="flex flex-col gap-4">
                    <label className="flex w-full flex-col gap-2 text-sm font-medium text-slate-200">
                      Archivo a corregir
                      <input
                        type="file"
                        onChange={handleSubmissionChange}
                        className="block w-full cursor-pointer rounded-2xl border border-slate-800/60 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 shadow-inner transition focus:border-purple-400/70 focus:outline-none focus:ring-2 focus:ring-purple-500/40 file:mr-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-purple-400 file:to-sky-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:file:brightness-110"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleGradeSubmission}
                      disabled={isGrading}
                      className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-purple-400 via-sky-500 to-emerald-400 px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_25px_60px_rgba(168,85,247,0.35)] transition focus:outline-none focus:ring-2 focus:ring-purple-400/70 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGrading ? 'Corrigiendo…' : 'Corregir'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Debes contar con una rúbrica JSON (generada o importada) y un archivo a corregir para habilitar la corrección.
                  </p>
                  {gradingError && (
                    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100 shadow-inner">
                      <strong className="block text-rose-100">{gradingError.message}</strong>
                      {gradingError.details && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-rose-100/90">{gradingError.details}</pre>}
                    </div>
                  )}
                </div>
              </section>

              <section className="group relative overflow-hidden rounded-3xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-card transition duration-500 hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_35px_90px_rgba(56,189,248,0.25)]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-4">
                  <h2 className="text-xl font-semibold text-slate-100">Resultado de la corrección</h2>
                  {gradingResponse ? (
                    <pre className="result-scrollbar max-h-[520px] overflow-auto rounded-2xl border border-slate-800/60 bg-slate-950/70 p-4 text-sm leading-relaxed text-slate-200 shadow-inner">
                      {typeof gradingResponse === 'string' ? gradingResponse : formatJson(gradingResponse)}
                    </pre>
                  ) : (
                    <p className="text-sm text-slate-400">
                      La respuesta del webhook de corrección aparecerá aquí.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </main>

          <footer className="mt-16 text-center text-xs text-slate-500">
            Configura las URLs de los webhooks con las variables <code className="text-sky-300">VITE_RUBRIC_WEBHOOK_URL</code>{' '}
            y <code className="text-sky-300">VITE_GRADING_WEBHOOK_URL</code> en un archivo <code className="text-slate-300">.env</code>.
          </footer>
        </div>
      </div>
    </div>
  );
};

export default App;
