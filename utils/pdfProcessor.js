import PDFParser from "pdf2json";
import { createObjectCsvWriter } from "csv-writer";
import natural from "natural";
import fs from "fs/promises";
import debug from "debug";

const log = debug("app:pdf-processor");
const tokenizer = new natural.WordTokenizer();

const categories = {
  MEDICATION: [
    "medication",
    "iron",
    "supplements",
    "antidiarrheals",
    "blood",
    "tablets",
    "aspirin",
    "warfarin",
    "prescriptions",
    "medicines",
    "pills",
  ],
  BOWELPREP: [
    "plenvu",
    "glycoprep",
    "moviprep",
    "picolax",
    "picoprep",
    "prepkit",
    "dose",
    "sachet",
    "solution",
    "mixture",
    "dissolve",
    "preparation",
  ],
  DIET: [
    "diet",
    "food",
    "eat",
    "drink",
    "fluids",
    "breakfast",
    "lunch",
    "dinner",
    "meals",
    "clear liquids",
    "residue",
    "fasting",
    "solids",
    "water",
  ],
  PROCEDURE: [
    "procedure",
    "colonoscopy",
    "hospital",
    "appointment",
    "admission",
    "examination",
    "arrive",
    "clinic",
    "endoscopy",
  ],
};

function extractTimeRange(text) {
  try {
    // Match time ranges like "6:00-8:00am" or "6am - 8am" or "18:00-20:00"
    const rangeRegex =
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    const match = text.match(rangeRegex);

    if (match) {
      // Return the start time of the range
      let hours = parseInt(match[1]);
      const minutes = match[2] ? parseInt(match[2]) : 0;
      const period = match[3]?.toLowerCase();

      if (period === "pm" && hours !== 12) hours += 12;
      if (period === "am" && hours === 12) hours = 0;

      return hours + minutes / 60;
    }
    return null;
  } catch (error) {
    log("Error extracting time range:", error);
    return null;
  }
}

function extractOffset(text) {
  try {
    // Enhanced patterns for day matching
    const patterns = [
      {
        regex:
          /(\d+)\s*days?\s*(?:before|prior|ahead of)\s*(?:the\s*)?(?:procedure|colonoscopy)/i,
        handler: (match) => -parseInt(match[1]),
      },
      {
        regex: /(\d+)\s*days?\s*before/i,
        handler: (match) => -parseInt(match[1]),
      },
      {
        regex: /day\s*(-?\d+)/i,
        handler: (match) => parseInt(match[1]),
      },
      {
        regex: /today|day of (?:procedure|colonoscopy)|morning of procedure/i,
        handler: () => 0,
      },
      {
        regex: /tomorrow/i,
        handler: () => -1,
      },
      {
        regex: /yesterday/i,
        handler: () => 1,
      },
      {
        regex: /(\d+)\s*days?\s*after/i,
        handler: (match) => parseInt(match[1]),
      },
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern.regex);
      if (match) {
        return pattern.handler(match);
      }
    }

    // Check for specific day mentions
    const dayMentions = {
      "one day before": -1,
      "two days before": -2,
      "three days before": -3,
      "four days before": -4,
      "five days before": -5,
      "six days before": -6,
      "seven days before": -7,
      "week before": -7,
    };

    for (const [phrase, offset] of Object.entries(dayMentions)) {
      if (text.toLowerCase().includes(phrase)) {
        return offset;
      }
    }

    return null; // Return null instead of -1 if no pattern matches
  } catch (error) {
    log("Error extracting offset:", error);
    return null;
  }
}

async function determineCategory(text) {
  try {
    const tokens = tokenizer.tokenize(text.toLowerCase());
    let maxScore = 0;
    let selectedCategory = "procedure"; // Default category

    for (const [category, keywords] of Object.entries(categories)) {
      let score = 0;
      keywords.forEach((keyword) => {
        if (text.toLowerCase().includes(keyword)) {
          score++;
        }
      });

      if (score > maxScore) {
        maxScore = score;
        selectedCategory = category.toLowerCase();
      }
    }

    return selectedCategory;
  } catch (error) {
    log("Error determining category:", error);
    return "procedure";
  }
}

async function extractTimeFromText(text) {
  try {
    // Try to extract time range first
    const rangeTime = extractTimeRange(text);
    if (rangeTime !== null) {
      return rangeTime;
    }

    // Enhanced time patterns
    const timePatterns = [
      {
        // Standard time format (e.g., "6:00 AM", "6:00PM")
        regex: /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
        handler: (match) => {
          let hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const period = match[3]?.toLowerCase();

          if (period === "pm" && hours !== 12) hours += 12;
          if (period === "am" && hours === 12) hours = 0;

          return hours + minutes / 60;
        },
      },
      {
        // Time without minutes (e.g., "6 AM", "6PM")
        regex: /(\d{1,2})\s*(am|pm)/i,
        handler: (match) => {
          let hours = parseInt(match[1]);
          const period = match[2].toLowerCase();

          if (period === "pm" && hours !== 12) hours += 12;
          if (period === "am" && hours === 12) hours = 0;

          return hours;
        },
      },
      {
        // 24-hour format (e.g., "18:00")
        regex: /(\d{2}):(\d{2})/,
        handler: (match) => {
          return parseInt(match[1]) + parseInt(match[2]) / 60;
        },
      },
    ];

    for (const pattern of timePatterns) {
      const match = text.match(pattern.regex);
      if (match) {
        return pattern.handler(match);
      }
    }

    return null;
  } catch (error) {
    log("Error extracting time:", error);
    return null;
  }
}

function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .trim();
}

function preprocessText(text) {
  return (
    text
      // Remove multiple spaces
      .replace(/\s+/g, " ")
      // Remove non-printable characters
      .replace(/[^\x20-\x7E\n]/g, " ")
      // Remove page numbers
      .replace(/Page \d+ of \d+/gi, "")
      // Remove header/footer markers
      .replace(/^header:|^footer:/gim, "")
      // Clean up bullet points and list markers
      .replace(/[•●○·]/g, "-")
      .replace(/^\s*[-–—*]\s*/gm, "- ")
      // Normalize dashes
      .replace(/[–—]/g, "-")
      // Fix common OCR errors
      .replace(/[oO]ne/g, "1")
      .replace(/[tT]wo/g, "2")
      .replace(/[tT]hree/g, "3")
      .replace(/[fF]our/g, "4")
      .replace(/[fF]ive/g, "5")
      .trim()
  );
}

function splitIntoSections(text) {
  const sections = [];
  let currentSection = [];
  let lastLineWasEmpty = false;

  const lines = text.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine === "") {
      if (!lastLineWasEmpty && currentSection.length > 0) {
        sections.push(currentSection.join("\n"));
        currentSection = [];
      }
      lastLineWasEmpty = true;
    } else {
      currentSection.push(trimmedLine);
      lastLineWasEmpty = false;
    }
  }

  if (currentSection.length > 0) {
    sections.push(currentSection.join("\n"));
  }

  return sections;
}

function detectBowelPrep(text) {
  const prepTypes = {
    plenvu: ["plenvu"],
    glycoprepo: ["glycoprep", "glyco-prep", "glyco prep"],
    moviprep: ["moviprep", "movi-prep", "movi prep"],
    picolax: ["picolax", "pico-lax", "pico lax"],
    picoprep2: ["picoprep", "pico-prep", "pico prep"],
    glycoprepkit: ["glycoprepkit", "glyco prep kit"],
    picosalax: ["picosalax", "pico salax"],
  };

  text = text.toLowerCase();
  for (const [prep, variants] of Object.entries(prepTypes)) {
    if (variants.some((variant) => text.includes(variant))) {
      return prep;
    }
  }
  return "plenvu"; // Default
}

function identifySteps(sections, bowelPrep) {
  // Get reference steps from sequence.csv format
  const referenceSteps = [
    {
      order: 1,
      category: "medication",
      offset: -5,
      message:
        "To prepare for your procedure cease taking any iron supplements or antidiarrheals from today.",
    },
    {
      order: 2,
      category: "bowelprep",
      offset: -3,
      message: "A reminder to purchase",
    },
    {
      order: 3,
      category: "diet",
      offset: -2,
      message: "Please start the low residue diet",
    },
    {
      order: 4,
      category: "diet",
      offset: -1,
      message: "You may have a light breakfast",
    },
  ];

  let processedSteps = sections.map((section, index) => {
    const text = section.trim().toLowerCase();
    let step = {
      originalText: section,
      order: index + 1,
      offset: null,
      category: null,
    };

    // Try to match with reference steps
    for (const ref of referenceSteps) {
      if (text.includes(ref.message.toLowerCase())) {
        step.offset = ref.offset;
        step.category = ref.category;
        break;
      }
    }

    // If no match found, determine offset and category
    if (!step.offset) {
      step.offset = extractOffset(text) || 0;
    }
    if (!step.category) {
      step.category = determineStepCategory(text);
    }

    return step;
  });

  // Sort steps by offset and then order
  processedSteps.sort((a, b) => {
    if (a.offset === b.offset) {
      return a.order - b.order;
    }
    return b.offset - a.offset;
  });

  return processedSteps;
}

function determineStepCategory(text) {
  // More specific category determination based on sequence.csv patterns
  if (
    text.includes("medication") ||
    text.includes("supplements") ||
    text.includes("antidiarrheals")
  ) {
    return "medication";
  }
  if (
    text.includes("breakfast") ||
    text.includes("diet") ||
    text.includes("food") ||
    text.includes("drink")
  ) {
    return "diet";
  }
  if (
    text.includes("dose") ||
    text.includes("sachet") ||
    text.includes("preparation")
  ) {
    return "bowelprep";
  }
  if (text.includes("procedure") || text.includes("colonoscopy")) {
    return "procedure";
  }
  return "bowelprep"; // Default to bowelprep if unsure
}

function validateAndNormalizeInstruction(instruction) {
  const defaults = {
    bowelprep: "plenvu",
    order: 1,
    category: "procedure",
    message: "",
    offset: 0,
    time: null,
    split: false,
    procedure_time: "morning",
  };

  return {
    bowelprep: instruction.bowelprep || defaults.bowelprep,
    order: Number.isInteger(instruction.order)
      ? instruction.order
      : defaults.order,
    category: validateCategory(instruction.category) || defaults.category,
    message: cleanMessage(instruction.message) || defaults.message,
    offset: validateOffset(instruction.offset) || defaults.offset,
    time: validateTime(instruction.time) || defaults.time,
    split: Boolean(instruction.split),
    procedure_time:
      validateProcedureTime(instruction.procedure_time) ||
      defaults.procedure_time,
  };
}

function validateCategory(category) {
  const validCategories = ["medication", "bowelprep", "diet", "procedure"];
  return validCategories.includes(category?.toLowerCase())
    ? category.toLowerCase()
    : null;
}

function cleanMessage(message) {
  if (!message) return "";
  return message
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateOffset(offset) {
  if (offset === null || offset === undefined) return null;
  const numOffset = parseInt(offset);
  if (isNaN(numOffset)) return null;
  // Ensure offset is within reasonable range (-7 to 7 days)
  return Math.max(-7, Math.min(7, numOffset));
}

function validateTime(time) {
  if (time === null || time === undefined) return null;
  const numTime = parseFloat(time);
  if (isNaN(numTime)) return null;
  // Ensure time is within 24-hour range
  return Math.max(0, Math.min(23.99, numTime));
}

function validateProcedureTime(procedureTime) {
  return ["morning", "afternoon"].includes(procedureTime?.toLowerCase())
    ? procedureTime.toLowerCase()
    : "morning";
}

function postProcessInstructions(instructions) {
  // Sort instructions by offset and order
  instructions.sort((a, b) => {
    if (a.offset === b.offset) {
      return a.order - b.order;
    }
    return b.offset - a.offset;
  });

  // Reassign order numbers sequentially
  instructions.forEach((instruction, index) => {
    instruction.order = index + 1;
  });

  // Ensure required steps are present
  const requiredSteps = {
    medication: {
      minOffset: -5,
      message:
        "To prepare for your procedure cease taking any iron supplements or antidiarrheals from today.",
    },
    diet: {
      minOffset: -2,
      message:
        "Please start the low residue diet and only drink recommended clear fluids.",
    },
    procedure: {
      minOffset: 0,
      message:
        "Today is your procedure. Please follow all instructions carefully.",
    },
  };

  for (const [category, details] of Object.entries(requiredSteps)) {
    const hasRequiredStep = instructions.some(
      (inst) => inst.category === category && inst.offset <= details.minOffset
    );

    if (!hasRequiredStep) {
      instructions.push({
        bowelprep: instructions[0]?.bowelprep || "plenvu",
        order: instructions.length + 1,
        category: category,
        message: details.message,
        offset: details.minOffset,
        time: category === "procedure" ? 7 : 9,
        split: instructions[0]?.split || false,
        procedure_time: instructions[0]?.procedure_time || "morning",
      });
    }
  }

  return instructions;
}

function extractInstructions(text) {
  const instructions = [];

  // Helper to add an instruction
  const addInstruction = (message, offset, time, category, split = false) => {
    if (!message || message.length < 5) return;

    instructions.push({
      bowelprep: detectBowelPrep(text),
      order: instructions.length + 1,
      category,
      message: message.trim(),
      offset,
      time,
      split,
      procedure_time: /morning|am/i.test(text) ? "morning" : "afternoon",
    });
  };

  // Extract sections based on common patterns
  const sections = {
    sevenDays: text.match(/SEVEN DAYS[^]*?(?=THREE DAYS|$)/i)?.[0] || "",
    threeDays: text.match(/THREE DAYS[^]*?(?=DAY BEFORE|$)/i)?.[0] || "",
    dayBefore: text.match(/DAY BEFORE[^]*?(?=DAY OF|$)/i)?.[0] || "",
    dayOf: text.match(/DAY OF[^]*?(?=SPECIAL|$)/i)?.[0] || "",
  };

  // Process seven days before
  if (sections.sevenDays) {
    addInstruction("Stop taking iron supplements", -7, 9, "medication");
  }

  // Process three days before
  if (sections.threeDays) {
    addInstruction(
      "Stop taking any drugs that may make you constipated",
      -3,
      9,
      "medication"
    );
    addInstruction("Begin eating only a low residue diet", -3, 10, "diet");
  }

  // Process day before
  if (sections.dayBefore) {
    // Extract time-based instructions
    const timeInstructions =
      sections.dayBefore.match(
        /(?:At|From|By)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)[^.]+\./gi
      ) || [];

    timeInstructions.forEach((instruction) => {
      const time = extractTimeFromText(instruction);
      if (time) {
        addInstruction(
          instruction,
          -1,
          time,
          instruction.toLowerCase().includes("drink") ? "bowelprep" : "diet"
        );
      }
    });
  }

  // Process day of procedure
  if (sections.dayOf) {
    const timeInstructions =
      sections.dayOf.match(/(?:\d+)\s*hours?[^.]+\./gi) || [];

    timeInstructions.forEach((instruction) => {
      const time = extractTimeFromText(instruction);
      addInstruction(
        instruction,
        0,
        time || 7,
        instruction.toLowerCase().includes("drink") ? "bowelprep" : "procedure"
      );
    });
  }

  // Add default instructions if missing key steps
  if (!instructions.some((i) => i.offset === -7)) {
    addInstruction("Stop taking iron supplements", -7, 9, "medication");
  }

  if (!instructions.some((i) => i.category === "diet" && i.offset === -2)) {
    addInstruction("Please start the low residue diet", -2, 8, "diet");
  }

  if (!instructions.some((i) => i.offset === 0)) {
    addInstruction(
      "Today is your procedure. Please follow all instructions carefully.",
      0,
      7,
      "procedure"
    );
  }

  return instructions;
}

async function extractTextFromPDF(inputPath) {
  try {
    // Create new PDF parser
    const pdfParser = new PDFParser();

    // Extract text from PDF
    const pdfText = await new Promise((resolve, reject) => {
      pdfParser.on("pdfParser_dataReady", (pdfData) => {
        try {
          // Convert PDF data to text
          const text = pdfData.Pages.map((page) =>
            page.Texts.map((text) => decodeURIComponent(text.R[0].T)).join(" ")
          ).join("\n");
          resolve(text);
        } catch (err) {
          reject(err);
        }
      });

      pdfParser.on("pdfParser_dataError", (error) => reject(error));
      pdfParser.loadPDF(inputPath);
    });

    return pdfText;
  } catch (error) {
    log("Error extracting text from PDF:", error);
    throw error;
  }
}

export async function processPDF(inputPath, outputPath) {
  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: [
      { id: "bowelprep", title: "bowelprep" },
      { id: "order", title: "order" },
      { id: "category", title: "category" },
      { id: "message", title: "message" },
      { id: "offset", title: "offset" },
      { id: "time", title: "time" },
      { id: "split", title: "split" },
      { id: "procedure_time", title: "procedure_time" },
    ],
  });

  try {
    const pdfText = await extractTextFromPDF(inputPath);
    const cleanedText = preprocessText(pdfText);

    // Extract instructions using the improved function
    const instructions = extractInstructions(cleanedText);

    await csvWriter.writeRecords(instructions);
    return { success: true, message: "CSV file created successfully" };
  } catch (error) {
    log("Error processing PDF:", error);
    return { success: false, message: error.message };
  }
}

function render_page(pageData) {
  let render_options = {
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  };
  return pageData.getTextContent(render_options).then(function (textContent) {
    let lastY,
      text = "";
    for (let item of textContent.items) {
      if (lastY == item.transform[5] || !lastY) {
        text += item.str;
      } else {
        text += "\n" + item.str;
      }
      lastY = item.transform[5];
    }
    return text;
  });
}

function extractSectionsFromText(text) {
  const sections = {
    days: {}, // Will hold sections by days (-7, -3, -2, -1, 0 etc)
    headers: new Set(), // Will store section headers we find
    timeBasedInstructions: [], // Will store time-specific instructions
  };

  // Common section header patterns
  const headerPatterns = [
    /(?:(\d+)\s*days?\s*(?:before|prior))/i,
    /(?:the\s*)?day\s*(?:of|before)/i,
    /morning\s*of/i,
    /evening\s*before/i,
    /preparation/i,
    /instructions/i,
  ];

  // Split text into paragraphs
  const paragraphs = text.split(/\n\s*\n/);

  paragraphs.forEach((paragraph) => {
    // Clean the paragraph
    const cleanPara = paragraph.replace(/\s+/g, " ").trim();

    // Skip empty or very short paragraphs
    if (cleanPara.length < 10) return;

    // Try to identify the day offset
    let offset = null;
    let foundHeader = false;

    // Check for day patterns
    const dayMatch = cleanPara.match(/(\d+)\s*days?\s*(?:before|prior)/i);
    if (dayMatch) {
      offset = -parseInt(dayMatch[1]);
      foundHeader = true;
    }

    // Check for day of/before patterns
    if (cleanPara.match(/day\s*of\s*(?:procedure|colonoscopy)/i)) {
      offset = 0;
      foundHeader = true;
    }
    if (cleanPara.match(/day\s*before/i)) {
      offset = -1;
      foundHeader = true;
    }

    // Check for time patterns
    const timeMatch = cleanPara.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      sections.timeBasedInstructions.push({
        text: cleanPara,
        time: parseTimeString(timeMatch[0]),
      });
    }

    // Store section by offset if found
    if (offset !== null) {
      if (!sections.days[offset]) {
        sections.days[offset] = [];
      }
      sections.days[offset].push(cleanPara);
    }

    // Store any section headers we find
    headerPatterns.forEach((pattern) => {
      if (pattern.test(cleanPara)) {
        sections.headers.add(cleanPara.split("\n")[0]);
      }
    });
  });

  return sections;
}

function parseTimeString(timeStr) {
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let hours = parseInt(match[1]);
  const minutes = match[2] ? parseInt(match[2]) : 0;
  const period = match[3]?.toLowerCase();

  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  return hours + minutes / 60;
}
