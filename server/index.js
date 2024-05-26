import fs from "node:fs/promises";

import dotenv from "dotenv";
import express from "express";
import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/generative-ai";
import multer from "multer";
import path from "node:path";

dotenv.config();

const app = express();

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

/*
You are a witty social media manager for me.

I am Biraj, and my Twitter handle is @not_salgaonkar. My Instagram page name is @kachow_tweets, where I post screenshots of my tweets and twitter interactions.
*/

const SYSTEM_PROMPT = `
You are witty so you obviously understand when there's humour in my post. So I will give you those screenshots which you have to read and understand, and then give me the following:
- what you think the photo is about, and it should be no more than one line
- a funny caption for the photo
- relevant & trending hashtags based on the image


Your output should be formatted as JSON like this:
{
  "thoughts": "<your one line thought about the image>",
  "caption": "<a funny caption for the post>"
  "hashtags": "<array of hashtags>"
}


Again, understand the text in the image first and give me relevant data.

I want as much reach as possible so help me get viral.
`;

app.use(express.static("public"));

const upload = multer({
  storage: multer.diskStorage({
    destination: process.env.UPLOAD_DIR || "./uploads",
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  }),
});

app.post("/generate", upload.single("image"), async (req, res, next) => {
  try {
    let apiKey = req.body.apiKey?.trim();
    if (apiKey == process.env.MY_SECRET) {
      apiKey = process.env.MY_API_KEY;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: process.env.MODEL, safetySettings });

    const contextPrompt = req.body.prompt?.trim() || "";
    if (!contextPrompt) {
      res.status(400).json({
        message: "prompt is required",
      });

      return;
    }

    if (!req.file) {
      res.status(400).json({
        message: "image is required",
      });

      return;
    }

    const file = await fs.readFile(req.file.path);
    const image = {
      inlineData: {
        data: Buffer.from(file).toString("base64"),
        mimeType: "image/jpeg",
      },
    };

    const result = await model.generateContent([contextPrompt + "\n" + SYSTEM_PROMPT, image]);
    let resultText = result.response.text().trim();

    /*
     * gemini is returning markdown in the format
     * ```json
     * { ... }
     * ```
     *
     * so i am processing it
     */
    if (resultText.startsWith("`")) {
      const openingCurlyBracketIndex = resultText.indexOf("{");
      resultText = resultText.slice(openingCurlyBracketIndex);
    }

    if (resultText.endsWith("`")) {
      const closingCurlyBracketIndex = resultText.lastIndexOf("}");
      resultText = resultText.slice(0, closingCurlyBracketIndex + 1);
    }

    try {
      const responseJson = JSON.parse(resultText);
      res.json({
        message: "success",
        data: responseJson,
      });
    } catch (err) {
      res.status(500).json({
        message: "dumb model returned invalid JSON",
      });
    }
  } catch (err) {
    if (err instanceof GoogleGenerativeAIFetchError && Array.isArray(err.errorDetails) && err.errorDetails.length > 0) {
      res.status(err.status).json({
        message: `${err.statusText}: ${err.errorDetails[0].reason}`,
      });

      return;
    }

    next(err);
  } finally {
    if (!req.file) {
      return;
    }

    fs.unlink(req.file.path).catch((err) => console.error("error while deleting file:", err));
  }
});

app.use((req, res, next) => {
  res.status(404).json({
    message: "not found",
  });
});

app.use((err, req, res, next) => {
  console.error("error", err);

  res.status(500).json({
    message: "internal server error",
    ...(err.message && { debug: err.message }),
  });
});

const PORT = parseInt(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`server running on port ${PORT}...`));
