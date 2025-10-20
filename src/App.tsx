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
        <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-3 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-8 lg:px-10 lg:pb-16 lg:pt-12">
          <header className="relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/70 p-6 text-center shadow-card transition duration-500 hover:border-sky-400/60 sm:rounded-3xl sm:p-8 lg:p-10">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/20 via-purple-500/10 to-transparent" />
            <div className="relative space-y-3 motion-safe:animate-float sm:space-y-4">
              <span className="inline-flex items-center justify-center rounded-full border border-sky-400/40 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-sky-200/80 sm:px-4 sm:text-sm sm:tracking-[0.3em]">
                Automatiza tus evaluaciones
              </span>
              <h1 className="text-2xl font-semibold text-slate-50 sm:text-3xl lg:text-4xl">
                Generador y Corrector de Rúbricas
              </h1>
              <p className="mx-auto max-w-2xl text-sm text-slate-300 sm:text-base lg:text-lg">
                Convierte tus PDFs en rúbricas inteligentes y corrige entregas en segundos con tus flujos de n8n.
              </p>
            </div>
          </header>

          <main className="mt-6 grid gap-6 sm:mt-8 sm:gap-8 lg:mt-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)]">
            <div className="flex flex-col gap-6 sm:gap-8">
              <section className="group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-card transition duration-500 hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_35px_90px_rgba(56,189,248,0.25)] sm:rounded-3xl sm:p-6 lg:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/20 text-sm text-sky-300 ring-1 ring-inset ring-sky-400/40 sm:h-9 sm:w-9 sm:rounded-2xl">
                      1
                    </span>
                    <h2 className="text-lg font-semibold text-slate-100 sm:text-xl">Generar rúbrica desde PDF</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
                    Carga un examen parcial, final o trabajo práctico en PDF para transformarlo en una rúbrica JSON editable.
                  </p>
                  <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-end">
                    <label className="flex w-full flex-col gap-2 text-xs font-medium text-slate-200 sm:text-sm">
                      Archivo PDF
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={handleRubricPdfChange}
                        className="block w-full cursor-pointer rounded-xl border border-slate-800/60 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-100 shadow-inner transition focus:border-sky-400/70 focus:outline-none focus:ring-2 focus:ring-sky-500/40 file:mr-3 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-sky-400 file:to-indigo-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950 hover:file:brightness-110 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm file:sm:mr-4 file:sm:rounded-xl file:sm:px-4 file:sm:py-2 file:sm:text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRubric}
                      disabled={isGeneratingRubric}
                      className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl bg-gradient-to-r from-sky-400 via-indigo-500 to-purple-500 px-5 py-2.5 text-xs font-semibold text-slate-950 shadow-[0_25px_60px_rgba(56,189,248,0.35)] transition focus:outline-none focus:ring-2 focus:ring-sky-400/70 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-2xl sm:px-6 sm:py-3 sm:text-sm md:w-auto"
                    >
                      {isGeneratingRubric ? 'Generando…' : 'Convertir a rúbrica'}
                    </button>
                  </div>
                  <p className="text-[0.65rem] text-slate-400 sm:text-xs">
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

              <section className="group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-card transition duration-500 hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_35px_90px_rgba(56,189,248,0.25)] sm:rounded-3xl sm:p-6 lg:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/20 text-sm text-indigo-300 ring-1 ring-inset ring-indigo-400/40 sm:h-9 sm:w-9 sm:rounded-2xl">
                      2
                    </span>
                    <h2 className="text-lg font-semibold text-slate-100 sm:text-xl">Importar rúbrica existente</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
                    Si ya dispones de una rúbrica JSON, impórtala y úsala de inmediato en tus correcciones.
                  </p>
                  <label className="flex w-full flex-col gap-2 text-xs font-medium text-slate-200 sm:text-sm">
                    Archivo JSON
                    <input
                      type="file"
                      accept="application/json"
                      onChange={handleRubricImport}
                      className="block w-full cursor-pointer rounded-xl border border-slate-800/60 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-100 shadow-inner transition focus:border-indigo-400/70 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 file:mr-3 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-indigo-400 file:to-purple-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950 hover:file:brightness-110 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm file:sm:mr-4 file:sm:rounded-xl file:sm:px-4 file:sm:py-2 file:sm:text-sm"
                    />
                  </label>
                </div>
              </section>

              <section className="group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-card transition duration-500 hover:-translate-y-1 hover:border-emerald-400/60 hover:shadow-[0_35px_90px_rgba(16,185,129,0.25)] sm:rounded-3xl sm:p-6 lg:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-4 sm:space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                    <h2 className="text-lg font-semibold text-slate-100 sm:text-xl">{rubricTitle}</h2>
                    <button
                      type="button"
                      onClick={handleRubricDownload}
                      disabled={!hasRubric}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-emerald-400/60 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/20 focus:outline-none focus:ring-2 focus:ring-emerald-400/60 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40 sm:rounded-2xl sm:px-4 sm:py-2 sm:text-sm"
                    >
                      Descargar JSON
                    </button>
                  </div>
                  {hasRubric ? (
                    <pre className="code-scrollbar max-h-[300px] max-w-full overflow-x-auto overflow-y-auto rounded-xl border border-slate-800/60 bg-slate-950/70 p-3 text-xs leading-relaxed text-sky-200 shadow-inner sm:max-h-[400px] sm:rounded-2xl sm:p-4 sm:text-sm lg:max-h-[440px]">
                      {rubricJson}
                    </pre>
                  ) : (
                    <p className="text-xs text-slate-400 sm:text-sm">Genera o importa una rúbrica para visualizarla aquí.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-6 sm:gap-8">
              <section className="group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-card transition duration-500 hover:-translate-y-1 hover:border-purple-400/60 hover:shadow-[0_35px_90px_rgba(168,85,247,0.25)] sm:rounded-3xl sm:p-6 lg:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/20 text-sm text-purple-300 ring-1 ring-inset ring-purple-400/40 sm:h-9 sm:w-9 sm:rounded-2xl">
                      3
                    </span>
                    <h2 className="text-lg font-semibold text-slate-100 sm:text-xl">Corregir con rúbrica</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
                    Envía tu rúbrica JSON junto con el archivo a evaluar para obtener la nota final en segundos.
                  </p>
                  <div className="flex flex-col gap-3 sm:gap-4">
                    <label className="flex w-full flex-col gap-2 text-xs font-medium text-slate-200 sm:text-sm">
                      Archivo a corregir
                      <input
                        type="file"
                        onChange={handleSubmissionChange}
                        className="block w-full cursor-pointer rounded-xl border border-slate-800/60 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-100 shadow-inner transition focus:border-purple-400/70 focus:outline-none focus:ring-2 focus:ring-purple-500/40 file:mr-3 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-purple-400 file:to-sky-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950 hover:file:brightness-110 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm file:sm:mr-4 file:sm:rounded-xl file:sm:px-4 file:sm:py-2 file:sm:text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleGradeSubmission}
                      disabled={isGrading}
                      className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl bg-gradient-to-r from-purple-400 via-sky-500 to-emerald-400 px-5 py-2.5 text-xs font-semibold text-slate-950 shadow-[0_25px_60px_rgba(168,85,247,0.35)] transition focus:outline-none focus:ring-2 focus:ring-purple-400/70 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-2xl sm:px-6 sm:py-3 sm:text-sm"
                    >
                      {isGrading ? 'Corrigiendo…' : 'Corregir'}
                    </button>
                  </div>
                  <p className="text-[0.65rem] text-slate-400 sm:text-xs">
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

              <section className="group relative overflow-hidden rounded-2xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-card transition duration-500 hover:-translate-y-1 hover:border-sky-400/60 hover:shadow-[0_35px_90px_rgba(56,189,248,0.25)] sm:rounded-3xl sm:p-6 lg:p-8">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/15 via-transparent to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
                <div className="relative space-y-3 sm:space-y-4">
                  <h2 className="text-lg font-semibold text-slate-100 sm:text-xl">Resultado de la corrección</h2>
                  {gradingResponse ? (
                    <div className="result-scrollbar max-h-[300px] max-w-full overflow-x-auto overflow-y-auto rounded-xl border border-slate-800/60 bg-slate-950/70 p-3 shadow-inner sm:max-h-[450px] sm:rounded-2xl sm:p-4 lg:max-h-[520px] lg:p-5">
                      <pre className="result-content text-xs leading-relaxed text-slate-200 sm:text-sm">
                        {typeof gradingResponse === 'string' ? gradingResponse : formatJson(gradingResponse)}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 sm:text-sm">
                      La respuesta del webhook de corrección aparecerá aquí.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </main>

          <footer className="mt-8 px-2 text-center text-[0.65rem] text-slate-500 sm:mt-12 sm:text-xs lg:mt-16">
            Configura las URLs de los webhooks con las variables <code className="text-sky-300">VITE_RUBRIC_WEBHOOK_URL</code>{' '}
            y <code className="text-sky-300">VITE_GRADING_WEBHOOK_URL</code> en un archivo <code className="text-slate-300">.env</code>.
          </footer>
        </div>
      </div>
    </div>
  );
};

export default App;
