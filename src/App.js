import React, { useState, useMemo } from "react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { List } from "react-window";   // 👈 this is all that’s needed now
import "./App.css";


function parseCSV(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ""));
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? "").trim();
    });
    return obj;
  });

  return { headers, rows };
}

function computeColumnDifferences(headersA, headersB) {
  const onlyA = headersA.filter((h) => !headersB.includes(h));
  const onlyB = headersB.filter((h) => !headersA.includes(h));
  const common = headersA.filter((h) => headersB.includes(h));
  return { onlyA, onlyB, common, identical: onlyA.length === 0 && onlyB.length === 0 };
}

function computeMissingRows(table1, table2, pk) {
  if (!pk) return { onlyInA: [], onlyInB: [] };

  const keysA = new Set(table1.rows.map((row) => row[pk]));
  const keysB = new Set(table2.rows.map((row) => row[pk]));

  const onlyInA = table1.rows.filter((row) => !keysB.has(row[pk]));
  const onlyInB = table2.rows.filter((row) => !keysA.has(row[pk]));

  return { onlyInA, onlyInB };
}

function computeDifferences(table1, table2, pk) {
  if (!pk)
    return {
      matchingCount: 0,
      totalInA: 0,
      totalInB: 0,
      diffsByColumn: {},
      totalMismatches: 0,
    };

  const map2 = new Map();
  table2.rows.forEach((row) => map2.set(row[pk], row));

  let matchingCount = 0;
  const diffsByColumn = {};

  table1.headers.forEach((col) => {
    if (col !== pk) {
      diffsByColumn[col] = [];
    }
  });

  table1.rows.forEach((row1) => {
    const key = row1[pk];
    if (!map2.has(key)) return;
    const row2 = map2.get(key);
    matchingCount += 1;

    table1.headers.forEach((col) => {
      if (col === pk) return;
      const v1 = row1[col] ?? "";
      const v2 = row2[col] ?? "";
      if (v1 !== v2) {
        if (diffsByColumn[col].length < 200000) {
          diffsByColumn[col].push({
            [pk]: key,
            tableA: v1,
            tableB: v2,
          });
        }
      }
    });
  });

  const totalMismatches = Object.values(diffsByColumn).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  return {
    matchingCount,
    totalInA: table1.rows.length,
    totalInB: table2.rows.length,
    diffsByColumn,
    totalMismatches,
  };
}

/**
 * Virtualized, sortable mismatch table using react-window.
 * Shows all rows in a single scrollable view (no paging).
 */
function VirtualizedColumnDiffTable({ columnName, pk, diffRows }) {
  const [sortConfig, setSortConfig] = useState({ column: pk, direction: "asc" });

  const sortedRows = useMemo(() => {
    if (!diffRows || diffRows.length === 0) return [];
    const arr = [...diffRows];
    const { column, direction } = sortConfig;
    if (!column) return arr;

    arr.sort((a, b) => {
      const av = (a[column] || "").toString();
      const bv = (b[column] || "").toString();
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [diffRows, sortConfig]);

  const handleSort = (col) => {
    setSortConfig((prev) => {
      if (prev.column === col) {
        return { column: col, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { column: col, direction: "asc" };
    });
  };

  const sortIndicator = (col) => {
    if (sortConfig.column !== col) return "";
    return sortConfig.direction === "asc" ? " ↑" : " ↓";
  };

  if (!diffRows || diffRows.length === 0) return null;

  const ROW_HEIGHT = 32;
  const TABLE_HEIGHT = Math.min(400, Math.max(200, sortedRows.length * ROW_HEIGHT));

  const Row = ({ index, style }) => {
    const row = sortedRows[index];
    return (
      <tr style={style} key={index}>
        <td className="pk-cell">{row[pk]}</td>
        <td className="value-cell-a">{row.tableA}</td>
        <td className="value-cell-b">{row.tableB}</td>
      </tr>
    );
  };

  return (
    <div className="column-diff-table">
      <div className="column-diff-header">
        <span className="column-name">{columnName}</span>
        <span className="diff-count">
          {diffRows.length.toLocaleString()} differences
        </span>
      </div>
      <div className="table-wrapper" style={{ maxHeight: "none" }}>
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort(pk)}>
                {pk}
                {sortIndicator(pk)}
              </th>
              <th className="sortable" onClick={() => handleSort("tableA")}>
                Table A
                {sortIndicator("tableA")}
              </th>
              <th className="sortable" onClick={() => handleSort("tableB")}>
                Table B
                {sortIndicator("tableB")}
              </th>
            </tr>
          </thead>
        </table>
        {/* v2 react-window uses List instead of FixedSizeList */}
        <List
          height={TABLE_HEIGHT}
          itemCount={sortedRows.length}
          itemSize={ROW_HEIGHT}
          width={"100%"}
          outerElementType="tbody"
        >
          {Row}
        </List>
      </div>
    </div>
  );
}


function SortableMissingTable({ title, rows, pk, headers }) {
  const [sortConfig, setSortConfig] = useState({ column: pk, direction: "asc" });

  const [visibleStart, setVisibleStart] = useState(0);
  const PAGE_SIZE = 200;

  const sortedRows = useMemo(() => {
    if (!rows || rows.length === 0) return [];

    const arr = [...rows];
    const { column, direction } = sortConfig;
    if (!column) return arr;

    arr.sort((a, b) => {
      const av = (a[column] ?? "").toString();
      const bv = (b[column] ?? "").toString();
      if (av < bv) return direction === "asc" ? -1 : 1;
      if (av > bv) return direction === "asc" ? 1 : -1;
      return 0;
    });

    return arr;
  }, [rows, sortConfig]);

  const handleSort = (col) => {
    setSortConfig((prev) => ({
      column: col,
      direction:
        prev.column === col && prev.direction === "asc" ? "desc" : "asc",
    }));
    setVisibleStart(0);
  };

  const sortIndicator = (col) =>
    sortConfig.column === col ? ` ${sortConfig.direction === "asc" ? "↑" : "↓"}` : "";

  if (!rows || rows.length === 0) return null;

  const total = sortedRows.length;
  const visibleEnd = Math.min(visibleStart + PAGE_SIZE, total);
  const windowRows = sortedRows.slice(visibleStart, visibleEnd);
  const canPrev = visibleStart > 0;
  const canNext = visibleEnd < total;

  const goPrev = () => {
    if (canPrev) setVisibleStart(Math.max(0, visibleStart - PAGE_SIZE));
  };

  const goNext = () => {
    if (canNext) setVisibleStart(visibleStart + PAGE_SIZE);
  };

  return (
    <div className="table-container">
      <div className="table-header">
        {title} ({rows.length.toLocaleString()} rows)
        <span className="column-count">{headers.length} columns</span>
      </div>

      <div className="table-scroll-wrapper">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                {headers.map((col) => (
                  <th
                    key={col}
                    className="sortable"
                    onClick={() => handleSort(col)}
                    style={{
                      minWidth: Math.max(120, col.length * 10 + 40) + "px",
                    }}
                  >
                    {col}
                    {sortIndicator(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {windowRows.map((row, idx) => (
                <tr key={visibleStart + idx}>
                  {headers.map((col) => (
                    <td key={col} style={{ minWidth: "120px" }}>
                      {row[col] || "(empty)"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="scroll-indicator">
          {headers.length > 8 &&
            `← Scroll horizontally to see all ${headers.length} columns →`}
        </div>
      </div>

      {total > PAGE_SIZE && (
        <div
          style={{
            padding: "8px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "12px",
          }}
        >
          <span>
            Showing {visibleStart + 1}–{visibleEnd} of{" "}
            {total.toLocaleString()} rows
          </span>
          <div>
            <button
              onClick={goPrev}
              disabled={!canPrev}
              style={{ marginRight: "8px" }}
            >
              Prev
            </button>
            <button onClick={goNext} disabled={!canNext}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [tableA, setTableA] = useState({ headers: [], rows: [] });
  const [tableB, setTableB] = useState({ headers: [], rows: [] });
  const [pk, setPk] = useState("");
  const [loading, setLoading] = useState(false);

  const pkOptions = useMemo(() => {
    if (!tableA.headers.length || !tableB.headers.length) return [];
    return tableA.headers.filter((h) => tableB.headers.includes(h));
  }, [tableA.headers, tableB.headers]);

  const columnDiffs = useMemo(() => {
    return computeColumnDifferences(tableA.headers, tableB.headers);
  }, [tableA.headers, tableB.headers]);

  const missingRows = useMemo(() => {
    return computeMissingRows(tableA, tableB, pk);
  }, [tableA, tableB, pk]);

  const { matchingCount, totalInA, totalInB, diffsByColumn, totalMismatches } =
    useMemo(() => {
      if (!pk)
        return {
          matchingCount: 0,
          totalInA: 0,
          totalInB: 0,
          diffsByColumn: {},
          totalMismatches: 0,
        };
      return computeDifferences(tableA, tableB, pk);
    }, [tableA, tableB, pk]);

  const canCompare = tableA.headers.length > 0 && tableB.headers.length > 0 && pk;

  const handleFileChange = (e, which) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Please select a CSV file.");
      return;
    }

    if (which === "A") setFileA(file);
    else setFileB(file);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const parsed = parseCSV(text);
      if (which === "A") {
        setTableA(parsed);
      } else {
        setTableB(parsed);
      }
    };
    reader.readAsText(file);
  };

  const handleGeneratePDF = async () => {
    if (!tableA.rows.length || !tableB.rows.length) {
      alert("Please upload both files first.");
      return;
    }

    setLoading(true);

    try {
      const container = document.createElement("div");
      container.id = "pdf-container";
      container.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        width: 1200px !important;
        padding: 30px !important;
        background: #f5f7fa !important;
        font-family: inherit !important;
        box-sizing: border-box !important;
      `;
      document.body.appendChild(container);

      const appContent = document.querySelector(".app-container");
      const clone = appContent.cloneNode(true);

      const pkSelect = clone.querySelector("select");
      if (pkSelect && pk) {
        pkSelect.value = pk;
      }

      clone.querySelectorAll(".table-wrapper").forEach((wrapper) => {
        wrapper.style.maxHeight = "none";
        wrapper.style.overflow = "visible";
        wrapper.style.height = "auto";
      });

      clone.querySelectorAll("input, select, button").forEach((el) => {
        el.style.pointerEvents = "none";
      });

      container.appendChild(clone);

      await new Promise((r) => setTimeout(r, 100));

      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(container, {
        scale: 1.2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: null,
        width: 1200,
        height: Math.max(container.scrollHeight, 800),
        scrollX: 0,
        scrollY: 0,
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.9);
      const pdf = new jsPDF("p", "mm", "a4");

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgProps = pdf.getImageProperties(imgData);
      const pdfImgWidth = pdfWidth;
      const pdfImgHeight = (imgProps.height * pdfWidth) / imgProps.width;

      let heightLeft = pdfImgHeight;
      let position = 0;

      pdf.addImage(imgData, "JPEG", 0, position, pdfImgWidth, pdfImgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft >= 0) {
        position = heightLeft - pdfImgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pdfImgWidth, pdfImgHeight);
        heightLeft -= pdfHeight;
      }

      document.body.removeChild(container);
      pdf.save(`comparison-report-${Date.now()}.pdf`);
    } catch (error) {
      console.error(error);
      alert(`PDF Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <h1>CSV Table Comparison Tool</h1>

      <div className="section">
        <div className="section-title">Upload Files</div>
        <div className="controls-row">
          <div className="file-input-group">
            <label>Table A (Reference):</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileChange(e, "A")}
            />
            {fileA && <span className="file-name">✓ {fileA.name}</span>}
          </div>
          <div className="file-input-group">
            <label>Table B (Compare):</label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => handleFileChange(e, "B")}
            />
            {fileB && <span className="file-name">✓ {fileB.name}</span>}
          </div>
        </div>
      </div>

      {pkOptions.length > 0 && (
        <div className="section">
          <div className="section-title">Select Primary Key</div>
          <div className="controls-row">
            <select value={pk} onChange={(e) => setPk(e.target.value)}>
              <option value="">Choose primary key column...</option>
              {pkOptions.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">Summary</div>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">Row Counts</div>
            <div className="summary-value">
              A: {totalInA} | B: {totalInB}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-label">PK Matching</div>
            <div className="summary-value">{matchingCount} matched</div>
            <div className="summary-subtext">
              Missing: {missingRows.onlyInA.length} | Extra:{" "}
              {missingRows.onlyInB.length}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Columns</div>
            <div
              className={
                columnDiffs.identical
                  ? "summary-value-success"
                  : "summary-value-warning"
              }
            >
              {columnDiffs.identical
                ? "Identical"
                : `${columnDiffs.onlyA.length} missing, ${columnDiffs.onlyB.length} extra`}
            </div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Data Mismatches</div>
            <div className="summary-value">
              {totalMismatches} differences
            </div>
          </div>
        </div>
      </div>

      {!columnDiffs.identical && tableA.headers.length > 0 && (
        <div className="section">
          <div className="section-title">Column Structure Differences</div>
          <div className="column-structure">
            {columnDiffs.onlyA.length > 0 && (
              <div className="structure-group">
                <div className="structure-label error">
                  Missing in Table B:
                </div>
                <div className="structure-list">
                  {columnDiffs.onlyA.join(", ")}
                </div>
              </div>
            )}
            {columnDiffs.onlyB.length > 0 && (
              <div className="structure-group">
                <div className="structure-label warning">
                  Extra in Table B:
                </div>
                <div className="structure-list">
                  {columnDiffs.onlyB.join(", ")}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canCompare && (
        <div className="section">
          <div className="section-title">Missing Rows</div>
          <div className="missing-rows-section">
            <SortableMissingTable
              title="Missing from Table B"
              rows={missingRows.onlyInA}
              pk={pk}
              headers={tableA.headers}
            />
            <SortableMissingTable
              title="Extra in Table B"
              rows={missingRows.onlyInB}
              pk={pk}
              headers={tableB.headers}
            />
            {missingRows.onlyInA.length === 0 &&
              missingRows.onlyInB.length === 0 && (
                <div className="success-message">
                  All primary keys present in both tables
                </div>
              )}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-title">Data Mismatches by Column</div>
        {canCompare ? (
          <div className="column-diff-container">
            {Object.keys(diffsByColumn).map((colName) => (
              <VirtualizedColumnDiffTable
                key={colName}
                columnName={colName}
                pk={pk}
                diffRows={diffsByColumn[colName]}
              />
            ))}
            {totalMismatches === 0 && (
              <div className="success-message">
                All data values match for matching primary keys
              </div>
            )}
          </div>
        ) : (
          <div className="info-message">
            Upload files and select primary key to compare data
          </div>
        )}
      </div>

      <div className="section action-section">
        <button
          className="pdf-button"
          onClick={handleGeneratePDF}
          disabled={!tableA.rows.length || !tableB.rows.length || loading}
        >
          {loading ? "Generating PDF..." : "Download PDF Report"}
        </button>
      </div>
    </div>
  );
}

export default App;
