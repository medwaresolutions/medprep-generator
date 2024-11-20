import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function getMasterSequence(bowelPrep, procedureTime) {
  try {
    console.log("Getting master sequence for:", { bowelPrep, procedureTime });

    const sequencePath = path.join(
      __dirname,
      "..",
      "pdf-examples",
      "sequence.csv"
    );
    console.log("Reading from path:", sequencePath);

    const content = await fs.readFile(sequencePath, "utf-8");

    // Parse CSV properly using csv-parse
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      quote: '"',
      escape: '"',
    });

    // Convert and filter records
    const masterData = records
      .map((record) => ({
        bowelprep: record.bowelprep,
        order: parseInt(record.order),
        category: record.category,
        message: record.message,
        offset: parseInt(record.offset),
        time: parseFloat(record.time),
        split: record.split === "true",
        procedure_time: record.procedure_time,
      }))
      .filter(
        (row) =>
          row.bowelprep.toLowerCase() === bowelPrep.toLowerCase() &&
          row.procedure_time.toLowerCase() === procedureTime.toLowerCase()
      );

    console.log(`Found ${masterData.length} matching rows`);
    masterData.forEach((row) =>
      console.log(`Order ${row.order}: ${row.message.substring(0, 50)}...`)
    );

    // Sort by order
    masterData.sort((a, b) => a.order - b.order);

    return masterData;
  } catch (error) {
    console.error("Error loading master sequence:", error);
    throw error;
  }
}
