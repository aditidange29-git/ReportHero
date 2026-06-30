import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Ensure Gemini Client is lazy initialized and handles missing keys gracefully
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for base64 image uploads
  app.use(express.json({ limit: "15mb" }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // AI Image Analysis Endpoint
  app.post("/api/analyze", async (req, res) => {
    try {
      const { image, location } = req.body;

      if (!image) {
        return res.status(400).json({ error: "No image data provided" });
      }

      // Extract base64 parts
      const matches = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: "Invalid image format. Must be base64 data URL." });
      }

      const mimeType = matches[1];
      const base64Data = matches[2];

      // Lazy load Gemini client
      const ai = getGeminiClient();

      const imagePart = {
        inlineData: {
          mimeType: mimeType,
          data: base64Data,
        },
      };

      const promptPart = {
        text: `You are an expert civic issue analyzer for India. Analyze this image located at or around "${location || 'unspecified area'}" and respond ONLY with a valid JSON object matching the requested schema. Do not include markdown codeblocks or explanations, just raw JSON.`,
      };

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts: [imagePart, promptPart] },
        config: {
          systemInstruction: "You are a professional assistant designed to help local municipal corporations identify, categorize, and prioritize civic issues. Be accurate, strictly adhere to categories and departments list.",
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT" as any,
            properties: {
              title: { type: "STRING" as any, description: "concise issue title under 10 words" },
              description: { type: "STRING" as any, description: "professional 2-3 sentence description of the civic issue" },
              category: { 
                type: "STRING" as any, 
                enum: ["Pothole", "Streetlight", "Garbage", "Water Leak", "Drainage", "Illegal Dumping", "Road Damage", "Public Property", "Other"] 
              },
              severity: { 
                type: "STRING" as any, 
                enum: ["Low", "Medium", "High", "Critical"] 
              },
              urgency_score: { type: "INTEGER" as any, description: "urgency score between 1 and 10" },
              department: { 
                type: "STRING" as any, 
                enum: ["Municipal Roads Dept", "Water Supply Board", "Sanitation Dept", "Electricity Board", "Town Planning", "Public Works Dept"] 
              },
              estimated_resolution_days: { type: "INTEGER" as any, description: "estimated days to resolve" },
              citizen_tip: { type: "STRING" as any, description: "one helpful actionable sentence for the citizen" },
              ai_confidence: { type: "NUMBER" as any, description: "AI analysis confidence score between 0.70 and 0.99" }
            },
            required: ["title", "description", "category", "severity", "urgency_score", "department", "estimated_resolution_days", "citizen_tip", "ai_confidence"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini");
      }

      // Parse and validate response
      const parsedData = JSON.parse(text.trim());
      res.json(parsedData);

    } catch (error: any) {
      console.error("Gemini Analysis Error:", error);
      res.status(500).json({ 
        error: "AI analysis failed. Please ensure your image is clear and try again.", 
        details: error.message 
      });
    }
  });

  // Serve static files or setup Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ReportHero Server running on http://localhost:${PORT}`);
  });
}

startServer();
