const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Busboy = require("busboy");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const OpenAI = require("openai");

if (!admin.apps.length) {
  admin.initializeApp();
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function parseMultipartFile(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) {
      resolve(null);
      return;
    }

    const bb = Busboy({ headers: req.headers });
    const chunks = [];
    let hasFile = false;

    bb.on("file", (_fieldname, file) => {
      hasFile = true;
      file.on("data", (data) => chunks.push(data));
      file.on("error", reject);
    });

    bb.on("error", reject);

    bb.on("finish", () => {
      if (!hasFile || chunks.length === 0) {
        reject(new Error("No file found in multipart payload."));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    bb.end(req.rawBody);
  });
}

async function normalizeIncomingFile(req) {
  const multipartBuffer = await parseMultipartFile(req).catch((err) => {
    throw err;
  });

  if (multipartBuffer) {
    return multipartBuffer;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const body = req.body || {};
  const raw = body.fileBase64 || body.file || null;

  if (!raw) {
    throw new Error("Missing file payload. Provide file or fileBase64 in request body.");
  }

  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (typeof raw !== "string") {
    throw new Error("Invalid file payload format. Expected base64 string or Buffer.");
  }

  const cleaned = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(cleaned, "base64");
}

function extractFirstJsonObject(text) {
  if (!text || typeof text !== "string") {
    throw new Error("AI returned empty response.");
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("AI response is not valid JSON.");
    }

    return JSON.parse(text.slice(start, end + 1));
  }
}

function withResponseShape(result) {
  return {
    tests: Array.isArray(result.tests) ? result.tests : [],
    summary: typeof result.summary === "string" ? result.summary : "",
    anomalies: Array.isArray(result.anomalies) ? result.anomalies : [],
    advice: typeof result.advice === "string" ? result.advice : "",
  };
}

exports.analyzeReport = functions
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
      return;
    }

    try {
      const fileBuffer = await normalizeIncomingFile(req);

      let extractedText = "";
      try {
        const pdfData = await pdfParse(fileBuffer);
        extractedText = (pdfData.text || "").trim();
      } catch (pdfErr) {
        const ocr = await Tesseract.recognize(fileBuffer, "eng");
        extractedText = (ocr.data.text || "").trim();
      }

      if (!extractedText) {
        res.status(422).json({ error: "Could not extract readable text from report." });
        return;
      }

      const aiResponse = await client.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `Extract and analyze blood report data.\n\nReturn ONLY JSON:\n{\n  "tests": [],\n  "summary": "",\n  "anomalies": [],\n  "advice": ""\n}\n\nRules:\n- Compare with normal ranges\n- Mark HIGH / LOW clearly\n- Provide simple health suggestions`,
          },
          {
            role: "user",
            content: extractedText,
          },
        ],
        temperature: 0.1,
      });

      const content = aiResponse.choices?.[0]?.message?.content || "";
      const parsed = extractFirstJsonObject(content);
      const result = withResponseShape(parsed);

      await admin.firestore().collection("reports").add({
        ...result,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        extractedTextPreview: extractedText.slice(0, 2000),
      });

      res.json(result);
    } catch (err) {
      functions.logger.error("analyzeReport failed", err);
      res.status(500).json({ error: "Error processing report" });
    }
  });
