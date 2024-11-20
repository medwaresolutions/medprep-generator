import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { processPDF } from "./utils/pdfProcessor.js";
import fs from "fs/promises";
import { getMasterSequence } from "./utils/masterSequence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// Ensure upload and output directories exist
async function ensureDirectories() {
  const dirs = ["uploads", "output"];
  for (const dir of dirs) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir);
    }
  }
}

ensureDirectories();

// Serve static files
app.use(express.static("public"));

// Handle PDF upload
app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    console.log("Upload request received");

    if (!req.file) {
      console.log("No file uploaded");
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    console.log("File received:", req.file.originalname);
    const inputPath = req.file.path;
    const outputPath = path.join(
      "output",
      `${path.parse(req.file.originalname).name}.csv`
    );

    console.log("Processing PDF...");
    console.log("Input path:", inputPath);
    console.log("Output path:", outputPath);

    const result = await processPDF(inputPath, outputPath);
    console.log("Process result:", result);

    if (result.success) {
      try {
        // Read the generated CSV
        console.log("Reading generated CSV...");
        const csvContent = await fs.readFile(outputPath, "utf-8");
        const rows = csvContent
          .split("\n")
          .slice(1) // Skip header row
          .filter((row) => row.trim()) // Remove empty rows
          .map((row) => {
            const columns = row.split(",");
            return {
              bowelprep: columns[0],
              order: parseInt(columns[1]),
              category: columns[2],
              message: columns[3].replace(/^"|"$/g, ""),
              offset: parseInt(columns[4]),
              time: parseFloat(columns[5]),
              split: columns[6] === "true",
              procedure_time: columns[7],
            };
          });

        console.log("Sending response with data...");
        res.json({
          success: true,
          message: "PDF processed successfully",
          downloadPath: `/download/${path.parse(outputPath).base}`,
          data: rows,
        });
      } catch (error) {
        console.error("Error reading CSV:", error);
        res.status(500).json({
          success: false,
          message: "Error reading generated CSV",
        });
      }
    } else {
      console.log("Processing failed:", result.message);
      res.status(500).json({
        success: false,
        message: result.message || "Error processing PDF",
      });
    }

    // Clean up uploaded PDF
    try {
      await fs.unlink(inputPath);
      console.log("Cleaned up uploaded file");
    } catch (error) {
      console.error("Error cleaning up file:", error);
    }
  } catch (error) {
    console.error("Error in upload endpoint:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Handle CSV download
app.get("/download/:filename", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "output", req.params.filename);
    await fs.access(filePath);
    res.download(filePath, req.params.filename, async (err) => {
      if (!err) {
        // Clean up CSV file after download
        try {
          await fs.unlink(filePath);
        } catch (error) {
          console.error("Error deleting CSV:", error);
        }
      }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: "File not found",
    });
  }
});

// Get master sequence data
app.get("/api/master-sequence", async (req, res) => {
  try {
    const { bowelPrep, procedureTime } = req.query;
    console.log("Fetching master sequence for:", { bowelPrep, procedureTime });

    if (!bowelPrep || !procedureTime) {
      return res.status(400).json({
        error: "Please select both bowel prep type and procedure time",
      });
    }

    // Read and parse sequence.csv
    const sequencePath = path.join(__dirname, "pdf-examples", "sequence.csv");
    console.log("Reading from:", sequencePath);

    const content = await fs.readFile(sequencePath, "utf-8");
    console.log("Content length:", content.length);

    // Parse CSV content with better handling of quotes and commas
    const rows = content
      .split("\n")
      .filter((row) => row.trim()) // Remove empty rows
      .map((row) => {
        // Handle quoted fields properly
        const fields = [];
        let field = "";
        let inQuotes = false;

        for (let i = 0; i < row.length; i++) {
          const char = row[i];

          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === "," && !inQuotes) {
            fields.push(field.trim());
            field = "";
          } else {
            field += char;
          }
        }
        fields.push(field.trim());

        return fields;
      })
      .slice(1); // Skip header row

    console.log("Total rows parsed:", rows.length);

    // Convert to objects and filter
    const masterData = rows
      .map((fields) => ({
        bowelprep: fields[0].replace(/^"|"$/g, ""),
        order: parseInt(fields[1]),
        category: fields[2].replace(/^"|"$/g, ""),
        message: fields[3].replace(/^"|"$/g, ""),
        offset: parseInt(fields[4]),
        time: parseFloat(fields[5]),
        split: fields[6] === "true",
        procedure_time: fields[7].replace(/^"|"$/g, ""),
      }))
      .filter(
        (row) =>
          row.bowelprep.toLowerCase() === bowelPrep.toLowerCase() &&
          row.procedure_time.toLowerCase() === procedureTime.toLowerCase()
      );

    console.log("Matching rows found:", masterData.length);
    console.log("First matching row:", masterData[0]);

    if (!masterData.length) {
      return res.status(404).json({
        error: "No instructions found for the selected options",
      });
    }

    // Sort by order
    masterData.sort((a, b) => a.order - b.order);

    res.json(masterData);
  } catch (error) {
    console.error("Error in master-sequence endpoint:", error);
    res.status(500).json({
      error: "Error fetching master sequence",
      details: error.message,
    });
  }
});

// Save edited data
app.post("/api/save-instructions", express.json(), async (req, res) => {
  const { generated, master } = req.body;
  try {
    const outputDir = path.join(__dirname, "output");

    // Save generated instructions
    await fs.writeFile(
      path.join(outputDir, "generated.csv"),
      convertToCSV(generated)
    );

    // Save master copy
    await fs.writeFile(
      path.join(outputDir, "master.csv"),
      convertToCSV(master)
    );

    res.json({
      success: true,
      message: "Instructions saved successfully",
      downloadPaths: {
        generated: "/download/generated.csv",
        master: "/download/master.csv",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
