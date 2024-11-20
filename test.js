import { processPDF } from "./utils/pdfProcessor.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function test() {
  try {
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, "output");
    try {
      await fs.access(outputDir);
    } catch {
      await fs.mkdir(outputDir, { recursive: true });
    }

    // Process each PDF file with correct filenames
    const pdfs = [
      {
        input: path.join(__dirname, "pdf-examples", "plenvu.pdf"),
        output: path.join(__dirname, "output", "plenvu-test.csv"),
      },
      {
        input: path.join(
          __dirname,
          "pdf-examples",
          "SVH BOWEL PREP MOVIPREP AND WHITE DIET.pdf"
        ),
        output: path.join(__dirname, "output", "moviprep-test.csv"),
      },
      {
        input: path.join(
          __dirname,
          "pdf-examples",
          "colonoscopy-bowel-prep-pm-3-5.pdf"
        ),
        output: path.join(__dirname, "output", "colonoscopy-test.csv"),
      },
    ];

    for (const pdf of pdfs) {
      console.log(`\nProcessing ${pdf.input}...`);

      try {
        await fs.access(pdf.input);
        console.log("Found input file:", pdf.input);
      } catch (error) {
        console.error(`Input file ${pdf.input} does not exist!`);
        continue;
      }

      try {
        console.log("Starting PDF processing...");
        const result = await processPDF(pdf.input, pdf.output);
        console.log("Processing result:", result);

        if (result.success) {
          const csvContent = await fs.readFile(pdf.output, "utf-8");
          console.log("\nFirst few lines of output:");
          console.log(csvContent.split("\n").slice(0, 5).join("\n"));
        }
      } catch (error) {
        console.error(`Error processing ${pdf.input}:`, error);
      }
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

test();
