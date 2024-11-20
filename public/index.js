// First, make these functions global by moving them outside DOMContentLoaded
window.addRow = function (tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const newRow = document.createElement("tr");
  const bowelPrep = document.getElementById("bowelPrep").value || "plenvu";
  const procedureTime =
    document.getElementById("procedureTime").value || "morning";

  newRow.innerHTML = `
        <td><input type="checkbox" onchange="toggleRowSelection(this)"></td>
        <td contenteditable="true">${tbody.children.length + 1}</td>
        <td contenteditable="true">procedure</td>
        <td contenteditable="true">New instruction</td>
        <td contenteditable="true">0</td>
        <td contenteditable="true">9</td>
    `;

  tbody.appendChild(newRow);

  // Update the data arrays
  const dataArray =
    tableId === "generatedTable" ? window.generatedData : window.masterData;
  dataArray.push({
    bowelprep: bowelPrep,
    order: tbody.children.length,
    category: "procedure",
    message: "New instruction",
    offset: 0,
    time: 9,
    split: false,
    procedure_time: procedureTime,
  });
};

window.deleteSelectedRows = function (tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const rows = Array.from(tbody.getElementsByTagName("tr"));
  const dataArray =
    tableId === "generatedTable" ? window.generatedData : window.masterData;

  rows.forEach((row, index) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox && checkbox.checked) {
      row.remove();
      dataArray.splice(index, 1);
    }
  });

  window.reorderRows(tableId);
};

window.toggleAllRows = function (tableId) {
  const table = document.getElementById(tableId);
  const headerCheckbox = table.querySelector('thead input[type="checkbox"]');
  const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');

  checkboxes.forEach((checkbox) => {
    checkbox.checked = headerCheckbox.checked;
    const row = checkbox.closest("tr");
    if (headerCheckbox.checked) {
      row.classList.add("row-selected");
    } else {
      row.classList.remove("row-selected");
    }
  });
};

window.reorderRows = function (tableId) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const rows = Array.from(tbody.getElementsByTagName("tr"));
  const dataArray =
    tableId === "generatedTable" ? window.generatedData : window.masterData;

  rows.forEach((row, index) => {
    row.cells[1].textContent = index + 1;
    if (dataArray[index]) {
      dataArray[index].order = index + 1;
    }
  });
};

window.toggleRowSelection = function (checkbox) {
  const row = checkbox.closest("tr");
  if (checkbox.checked) {
    row.classList.add("row-selected");
  } else {
    row.classList.remove("row-selected");
  }
};

// Make data arrays global
window.generatedData = [];
window.masterData = [];

// Keep your existing DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("uploadForm");
  const fileInput = document.getElementById("pdfFile");
  const submitBtn = document.getElementById("submitBtn");
  const showStepsBtn = document.getElementById("showSteps");
  const status = document.getElementById("status");
  const preview = document.getElementById("preview");

  // Add renderTable function
  function renderTable(tableId, data) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = "";

    // Sort data by order
    const sortedData = [...data].sort((a, b) => a.order - b.order);

    sortedData.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td>
                    <input type="checkbox" 
                           aria-label="Select instruction ${row.order}"
                           title="Select instruction ${row.order}"
                           onchange="toggleRowSelection(this)">
                </td>
                <td contenteditable="true">${row.order}</td>
                <td contenteditable="true">${row.category}</td>
                <td contenteditable="true">${row.message}</td>
                <td contenteditable="true">${row.offset}</td>
                <td contenteditable="true">${row.time || ""}</td>
            `;
      tbody.appendChild(tr);
    });

    // Log table data for debugging
    console.log(`${tableId} data:`, sortedData);
  }

  // Add downloadCSV function
  function downloadCSV(type, data) {
    const headers = [
      "bowelprep,order,category,message,offset,time,split,procedure_time",
    ];
    const rows = data.map((row) =>
      [
        row.bowelprep,
        row.order,
        row.category,
        `"${row.message.replace(/"/g, '""')}"`,
        row.offset,
        row.time || "",
        row.split,
        row.procedure_time,
      ].join(",")
    );

    const csv = headers.concat(rows).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-instructions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // Enable/disable show steps button based on selections
  function updateShowStepsButton() {
    const bowelPrep = document.getElementById("bowelPrep").value;
    const procedureTime = document.getElementById("procedureTime").value;
    showStepsBtn.disabled = !bowelPrep || !procedureTime;
  }

  document.getElementById("bowelPrep").addEventListener("change", async () => {
    updateShowStepsButton();
    // Clear existing master table when selection changes
    document.querySelector("#masterTable tbody").innerHTML = "";
    document.getElementById("downloadMaster").style.display = "none";
    masterData = [];
  });
  document
    .getElementById("procedureTime")
    .addEventListener("change", async () => {
      updateShowStepsButton();
      // Clear existing master table when selection changes
      document.querySelector("#masterTable tbody").innerHTML = "";
      document.getElementById("downloadMaster").style.display = "none";
      masterData = [];
    });

  // Show master steps when button clicked
  showStepsBtn.addEventListener("click", async () => {
    const bowelPrep = document.getElementById("bowelPrep").value;
    const procedureTime = document.getElementById("procedureTime").value;

    if (!bowelPrep || !procedureTime) {
      status.innerHTML =
        '<p class="error">Please select both bowel prep and procedure time</p>';
      return;
    }

    try {
      status.innerHTML = '<p class="processing">Loading master steps...</p>';

      const response = await fetch(
        `/api/master-sequence?bowelPrep=${encodeURIComponent(bowelPrep)}&procedureTime=${encodeURIComponent(procedureTime)}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        masterData = data;
        renderTable("masterTable", masterData);
        document.getElementById("downloadMaster").style.display = "block";
        status.innerHTML =
          '<p class="success">Master steps loaded successfully</p>';
        console.log(
          `Loaded ${data.length} steps for ${bowelPrep} (${procedureTime})`
        );
      } else {
        status.innerHTML =
          '<p class="error">No master steps found for selected options</p>';
        console.log(`No steps found for ${bowelPrep} (${procedureTime})`);
      }
    } catch (error) {
      console.error("Error loading master steps:", error);
      status.innerHTML = `<p class="error">Error loading master steps: ${error.message}</p>`;
    }
  });

  // File input handler
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file && file.type === "application/pdf") {
      submitBtn.disabled = false;
      preview.textContent = `Selected file: ${file.name}`;
    } else {
      submitBtn.disabled = true;
      preview.textContent = file ? "Please select a PDF file" : "";
    }
  });

  // Form submit handler
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const file = fileInput.files[0];
    if (!file) {
      status.innerHTML = '<p class="error">Please select a PDF file</p>';
      return;
    }

    submitBtn.disabled = true;
    status.innerHTML = '<p class="processing">Processing PDF...</p>';

    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        status.innerHTML = '<p class="success">PDF processed successfully!</p>';
        generatedData = result.data;
        renderTable("generatedTable", generatedData);
        document.getElementById("downloadGenerated").style.display = "block";
      } else {
        status.innerHTML = `<p class="error">Error: ${result.message}</p>`;
      }
    } catch (error) {
      status.innerHTML = `<p class="error">Error uploading file: ${error.message}</p>`;
    } finally {
      submitBtn.disabled = false;
      fileInput.value = "";
      preview.textContent = "";
    }
  });

  // Download handlers
  document.getElementById("downloadGenerated").addEventListener("click", () => {
    if (generatedData.length) {
      downloadCSV("generated", generatedData);
    }
  });

  document.getElementById("downloadMaster").addEventListener("click", () => {
    if (masterData.length) {
      downloadCSV("master", masterData);
    }
  });

  document.getElementById("downloadBoth").addEventListener("click", () => {
    if (generatedData.length && masterData.length) {
      downloadCSV("generated", generatedData);
      setTimeout(() => downloadCSV("master", masterData), 100);
    }
  });

  // Hide download buttons initially
  document.getElementById("downloadGenerated").style.display = "none";
  document.getElementById("downloadMaster").style.display = "none";
  document.getElementById("downloadBoth").style.display = "none";

  // Add drag and drop handlers
  const dropZone = document.querySelector(".file-input");

  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });

  function highlight(e) {
    dropZone.classList.add("drag-over");
  }

  function unhighlight(e) {
    dropZone.classList.remove("drag-over");
  }

  dropZone.addEventListener("drop", handleDrop, false);

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    fileInput.files = files;

    // Trigger change event
    const event = new Event("change");
    fileInput.dispatchEvent(event);
  }
});
