import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import crypto from "crypto";
import officeParser from "officeparser";
import * as XLSX from "xlsx";
import { createWorker } from "tesseract.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "700mb" }));

const PORT = 3000;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/* ==========================================================================
   Extracción de contenido (PDF, Word, audio, video)
   Esta es la ÚNICA parte del backend que lee, parsea o transcribe archivos.
   Se usa tanto para el botón "Transcribir" como para obtener el texto que
   luego reutilizan el resto de acciones (resumir, explicar, cuestionario...).
   ========================================================================== */

function convertirAudio(buffer, extension = "mp4") {

  return new Promise((resolve, reject) => {

    const id = crypto.randomUUID();
    const input = `temp_${id}.${extension}`;
    const output = `temp_${id}.mp3`;

    fs.writeFileSync(input, buffer);

    ffmpeg(input)
      .toFormat("mp3")
      .on("end", () => {

        const audio = fs.readFileSync(output);

        fs.unlinkSync(input);
        fs.unlinkSync(output);

        resolve(audio);

      })
      .on("error", (err) => {

        if (fs.existsSync(input)) fs.unlinkSync(input);

        reject(err);

      })
      .save(output);

  });

}

async function transcribirAudio(audioBuffer) {

  const id = crypto.randomUUID();
  const filePath = `audio_${id}.mp3`;

  fs.writeFileSync(filePath, audioBuffer);

  try {

    const transcription = await groq.audio.transcriptions.create({

      file: fs.createReadStream(filePath),

      model: "whisper-large-v3"

    });

    return transcription.text;

  } finally {

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  }

}

/**
 * Extrae el texto de una presentación PPTX (todas las diapositivas).
 */
async function extraerPptx(buffer) {

  return await officeParser.parseOfficeAsync(buffer);

}

/**
 * Extrae el contenido de un archivo XLSX: recorre cada hoja y la
 * convierte a texto tabular (CSV) legible para la IA.
 */
function extraerXlsx(buffer) {

  const workbook = XLSX.read(buffer, { type: "buffer" });

  let textoCompleto = "";

  workbook.SheetNames.forEach((nombreHoja) => {

    const hoja = workbook.Sheets[nombreHoja];
    const csv = XLSX.utils.sheet_to_csv(hoja);

    textoCompleto += `Hoja: ${nombreHoja}\n${csv}\n\n`;

  });

  return textoCompleto.trim();

}

/**
 * OCR de imágenes (JPG, PNG, etc.) usando Tesseract.
 * Se usa español como idioma principal de reconocimiento.
 */
async function ocrImagen(buffer) {

  const worker = await createWorker("spa");

  try {

    const { data } = await worker.recognize(buffer);
    return data.text;

  } finally {

    await worker.terminate();

  }

}

/**
 * Extrae el contenido textual de un archivo según su tipo MIME.
 * PDF y Word -> texto real del documento.
 * TXT -> texto plano tal cual.
 * PPTX -> texto de todas las diapositivas.
 * XLSX -> contenido de todas las hojas, en formato tabular.
 * Audio -> transcripción con Whisper.
 * Video -> se extrae el audio con FFmpeg y luego se transcribe.
 * Imágenes -> texto reconocido mediante OCR.
 */
async function extraerContenido(buffer, mimeType) {

  // PDF
  if (mimeType === "application/pdf") {

    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;

  }

  // WORD (.docx)
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {

    const result = await mammoth.extractRawText({ buffer });
    return result.value;

  }

  // TXT
  if (mimeType === "text/plain") {

    return buffer.toString("utf-8");

  }

  // PPTX
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {

    return await extraerPptx(buffer);

  }

  // XLSX
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {

    return extraerXlsx(buffer);

  }

  // IMÁGENES (OCR)
  if (mimeType.startsWith("image/")) {

    return await ocrImagen(buffer);

  }

  // AUDIO
  if (mimeType.startsWith("audio/")) {

    return await transcribirAudio(buffer);

  }

  // VIDEO -> extraer audio y transcribir
  if (mimeType.startsWith("video/")) {

    const extension = mimeType.split("/")[1] || "mp4";
    const audio = await convertirAudio(buffer, extension);
    return await transcribirAudio(audio);

  }

  throw new Error("Tipo de archivo no compatible todavía.");

}

/* ==========================================================================
   Prompts por acción
   ========================================================================== */

/**
 * Reglas de formato que se aplican a TODAS las respuestas de la IA.
 * Objetivo: que nunca aparezcan símbolos de Markdown (**, #, _, `, -)
 * y que el resultado se lea como un documento profesional ya terminado,
 * no como texto plano de un editor de código.
 */
const FORMAT_RULES = `
Reglas de formato obligatorias:
1. No uses símbolos de Markdown en ningún momento: nada de asteriscos (*), numerales (#), guiones bajos (_), comillas invertidas, ni guiones (-) como viñetas.
2. Escribe como si el texto se fuera a mostrar directamente en una aplicación para el usuario final, nunca como código fuente ni como un archivo .md.
3. Los títulos y subtítulos deben ser líneas de texto normal, con mayúscula inicial y, si corresponde, terminadas en dos puntos (ejemplo: Idea principal:).
4. Para listas, numera con "1.", "2.", "3." seguido de un espacio. No uses viñetas ni guiones.
5. Separa cada sección con una línea en blanco para que se lea con claridad.
6. Usa un tono claro, profesional y directo, sin relleno innecesario ni frases genéricas de relleno.
7. Responde siempre en español.
`;

const SYSTEM_PROMPT =
  "Eres StudyAI, un asistente académico experto que redacta como un documento profesional terminado. " +
  "Nunca usas símbolos de Markdown en tus respuestas. " +
  FORMAT_RULES;

const ACTION_PROMPTS = {

  resumir: (texto) =>
    `Resume el siguiente contenido para un estudiante.\n\n` +
    `Organiza tu respuesta así:\n` +
    `Idea principal: una o dos frases con lo más importante.\n` +
    `Puntos clave: lista numerada con los conceptos más relevantes.\n` +
    `Conclusión: un cierre breve que sintetice el contenido.\n\n` +
    `${FORMAT_RULES}\n\nContenido:\n\n${texto}`,

  redactar: (texto) =>
    `Redacta un texto claro, coherente y bien organizado a partir del siguiente contenido, ` +
    `con introducción, desarrollo y cierre.\n\n` +
    `${FORMAT_RULES}\n\nContenido:\n\n${texto}`,

  cuestionario: (texto) =>
    `Crea un cuestionario de estudio a partir del siguiente contenido. ` +
    `Numera cada pregunta ("1.", "2.", etc.) y coloca la respuesta esperada justo debajo de cada una, ` +
    `precedida por la palabra "Respuesta:".\n\n` +
    `${FORMAT_RULES}\n\nContenido:\n\n${texto}`,

  explicar: (texto) =>
    `Explica el siguiente contenido paso a paso, con lenguaje sencillo y al menos un ejemplo práctico ` +
    `que ayude a comprenderlo mejor.\n\n` +
    `${FORMAT_RULES}\n\nContenido:\n\n${texto}`,

  preguntas: (texto) =>
    `Genera preguntas relevantes sobre el siguiente contenido y responde cada una con claridad. ` +
    `Numera cada pregunta y coloca su respuesta justo debajo, precedida por la palabra "Respuesta:".\n\n` +
    `${FORMAT_RULES}\n\nContenido:\n\n${texto}`

};

/* ==========================================================================
   Rutas
   ========================================================================== */

/**
 * POST /api/extract
 * Recibe un archivo (base64) y devuelve su texto extraído/transcrito.
 * NO llama a la IA. Alimenta el botón "Transcribir" y cachea el texto
 * en el frontend para que el resto de acciones no vuelvan a leer el archivo.
 *
 * body: { file: string(base64), mimeType: string }
 * respuesta: { text: string }
 */
app.post("/api/extract", async (req, res) => {

  try {

    const { file, mimeType } = req.body;

    if (!file || !mimeType) {
      return res.status(400).json({ error: "Falta el archivo o el tipo de archivo." });
    }

    const buffer = Buffer.from(file, "base64");
    const text = await extraerContenido(buffer, mimeType);

    res.json({ text });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

});

/**
 * POST /api/process
 * Recibe el texto YA EXTRAÍDO (no vuelve a leer el archivo) junto con
 * la acción solicitada, y devuelve el resultado generado por la IA.
 *
 * body: { action: string, text: string }
 * respuesta: { result: string }
 */
app.post("/api/process", async (req, res) => {

  try {

    const { action, text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Falta el texto para procesar." });
    }

    const buildPrompt = ACTION_PROMPTS[action];

    if (!buildPrompt) {
      return res.status(400).json({ error: "Acción no reconocida." });
    }

    const completion = await groq.chat.completions.create({

     model: "openai/gpt-oss-20b",

      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(text) }
      ]

    });

    res.json({ result: completion.choices[0].message.content });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

});

/**
 * POST /api/gemini
 * Ruta original, se mantiene por compatibilidad hacia atrás.
 * Extrae el archivo y lo procesa en un solo paso (comportamiento anterior).
 */
app.post("/api/gemini", async (req, res) => {

  try {

    const { prompt, file, mimeType } = req.body;

    const buffer = Buffer.from(file, "base64");
    const textFile = await extraerContenido(buffer, mimeType);

    const completion = await groq.chat.completions.create({

      model: "llama-3.3-70b-versatile",

      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${prompt}\n\nContenido del archivo:\n\n${textFile}` }
      ]

    });

    res.json({ result: completion.choices[0].message.content });

  } catch (error) {

    res.status(500).json({ error: error.message });

  }

});

app.listen(PORT, () => {

  console.log("StudyAI backend activo en puerto " + PORT);

});
