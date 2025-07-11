import React, { useEffect, useState, useRef, useCallback } from "react";
import { Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Select, Button, HStack, Spinner, Checkbox, CheckboxGroup, useToast, Input, Textarea, Menu, MenuButton, MenuList, MenuItem } from "@chakra-ui/react";
import axios from "axios";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

const ALL_COLUMNS = [
  { key: "plate_number", label: "Plate" },
  { key: "detected_type", label: "Type" },
  { key: "detected_color", label: "Color" },
  { key: "plate_confidence", label: "Confidence" },
  { key: "feedback_status", label: "Feedback" },
  { key: "timestamp", label: "Time" }
];

function exportCSV(data, filename, columns, dateFormat) {
  const header = columns.map(c => c.label).join(",");
  const rows = data.map(row => columns.map(c => c.key === "timestamp" ? formatDate(row[c.key], dateFormat) : row[c.key]).join(","));
  const csv = [header].concat(rows).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

function exportExcel(data, filename, columns, dateFormat) {
  const rows = data.map(row => {
    const obj = {};
    columns.forEach(c => {
      obj[c.label] = c.key === "timestamp" ? formatDate(row[c.key], dateFormat) : row[c.key];
    });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Alerts");
  XLSX.writeFile(wb, filename);
}

function exportPDF(data, filename, columns, dateFormat) {
  const doc = new jsPDF();
  doc.autoTable({
    head: [columns.map(c => c.label)],
    body: data.map(a => columns.map(c => c.key === "timestamp" ? formatDate(a[c.key], dateFormat) : a[c.key]))
  });
  doc.save(filename);
}

function formatDate(date, format) {
  const d = new Date(date);
  if (format === "date") return d.toLocaleDateString();
  if (format === "time") return d.toLocaleTimeString();
  return d.toLocaleString();
}

export default function GuardAlertHistory() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedColumns, setSelectedColumns] = useState(ALL_COLUMNS.map(c => c.key));
  const [dateFormat, setDateFormat] = useState("datetime");
  const [users, setUsers] = useState([]);
  const [comment, setComment] = useState("");
  const loader = useRef();
  const toast = useToast();

  const fetchAlerts = async (pageNum = 1, append = false) => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/v1/alerts", { params: { page: pageNum, limit: 20 } });
      setAlerts(prev => append ? [...prev, ...res.data.alerts] : res.data.alerts);
      setTotalPages(res.data.total_pages);
    } catch (err) {
      setError("Failed to load alerts");
      toast({ title: "Error loading alerts", status: "error" });
    }
    setLoading(false);
  };

  useEffect(() => {
    setAlerts([]);
    setPage(1);
    fetchAlerts(1, false);
    axios.get("/api/v1/users").then(res => setUsers(res.data));
    // eslint-disable-next-line
  }, [filter]);

  useEffect(() => {
    if (page === 1) return;
    fetchAlerts(page, true);
    // eslint-disable-next-line
  }, [page]);

  const filtered = filter ? alerts.filter(a => a.feedback_status === filter) : alerts;
  const exportCols = ALL_COLUMNS.filter(c => selectedColumns.includes(c.key));

  // Infinite scroll
  const observer = useRef();
  const lastAlertRef = useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new window.IntersectionObserver(entries => {
      if (entries[0].isIntersecting && page < totalPages) {
        setPage(p => p + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, page, totalPages]);

  const assignAlert = (alertId, userId) => {
    axios.post(`/api/v1/alerts/${alertId}/assign`, { user_id: userId }).then(() => fetchAlerts(1, false));
  };
  const updateStatus = (alertId, status) => {
    axios.post(`/api/v1/alerts/${alertId}/status`, { status }).then(() => fetchAlerts(1, false));
  };
  const addComment = (alertId, comment) => {
    axios.post(`/api/v1/alerts/${alertId}/comment`, { comment }).then(() => fetchAlerts(1, false));
    setComment("");
  };

  return (
    <Box p={6}>
      <Heading mb={4}>Alert History</Heading>
      <HStack mb={4}>
        <Select value={filter} onChange={e => setFilter(e.target.value)} width="200px">
          <option value="">All</option>
          <option value="false_alarm">False Alarm</option>
          <option value="investigated">Investigated</option>
          <option value="escalated">Escalated</option>
        </Select>
        <CheckboxGroup value={selectedColumns} onChange={setSelectedColumns}>
          <HStack>
            {ALL_COLUMNS.map(col => (
              <Checkbox key={col.key} value={col.key}>{col.label}</Checkbox>
            ))}
          </HStack>
        </CheckboxGroup>
        <Select value={dateFormat} onChange={e => setDateFormat(e.target.value)} width="150px">
          <option value="datetime">Date & Time</option>
          <option value="date">Date Only</option>
          <option value="time">Time Only</option>
        </Select>
        <Button colorScheme="green" onClick={() => exportCSV(filtered, "alerts.csv", exportCols, dateFormat)}>Export CSV</Button>
        <Button colorScheme="blue" onClick={() => exportExcel(filtered, "alerts.xlsx", exportCols, dateFormat)}>Export Excel</Button>
        <Button colorScheme="red" onClick={() => exportPDF(filtered, "alerts.pdf", exportCols, dateFormat)}>Export PDF</Button>
      </HStack>
      <Table variant="simple">
        <Thead>
          <Tr>
            {exportCols.map(col => <Th key={col.key}>{col.label}</Th>)}
            <Th>Assigned To</Th>
            <Th>Status</Th>
            <Th>Comments</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {filtered.map((alert, i) => (
            <Tr key={alert.id} ref={i === filtered.length - 1 ? lastAlertRef : null}>
              {exportCols.map(col => (
                <Td key={col.key}>
                  {col.key === "timestamp" ? formatDate(alert[col.key], dateFormat) : alert[col.key]}
                </Td>
              ))}
              <Td>
                <Menu>
                  <MenuButton as={Button} size="xs">{users.find(u => u.id === alert.assigned_to)?.full_name || "Assign"}</MenuButton>
                  <MenuList>
                    {users.map(u => <MenuItem key={u.id} onClick={() => assignAlert(alert.id, u.id)}>{u.full_name}</MenuItem>)}
                  </MenuList>
                </Menu>
              </Td>
              <Td>
                <Select size="xs" value={alert.status} onChange={e => updateStatus(alert.id, e.target.value)}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="closed">Closed</option>
                </Select>
              </Td>
              <Td>
                <Box maxW="200px" whiteSpace="pre-wrap">{alert.comments}</Box>
                <Textarea size="xs" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add comment..." />
                <Button size="xs" mt={1} onClick={() => addComment(alert.id, comment)}>Add</Button>
              </Td>
              <Td>
                {/* Additional actions if needed */}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {loading && <Spinner mt={4} />}
      {error && <Box color="red.500" mb={2}>{error}</Box>}
    </Box>
  );
} 