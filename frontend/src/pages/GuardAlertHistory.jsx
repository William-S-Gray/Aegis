import React, { useEffect, useState, useRef, useCallback } from "react";
import { Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Select, Button, HStack, Spinner, Checkbox, CheckboxGroup, useToast, Textarea, Menu, MenuButton, MenuList, MenuItem } from "@chakra-ui/react";
import api from "../api";
import { asArray, asObject, asNumber } from "../utils/safe";
import { exportCSV, exportExcel, exportPDF, formatDate } from "../utils/exporters";
const ALL_COLUMNS = [
  { key: "plate_number", label: "Plate" },
  { key: "detected_type", label: "Type" },
  { key: "detected_color", label: "Color" },
  { key: "plate_confidence", label: "Confidence" },
  { key: "feedback_status", label: "Feedback" },
  { key: "timestamp", label: "Time" }
];

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
  // Keyed by alert id: a single shared draft leaked one row's text into every row.
  const [commentDrafts, setCommentDrafts] = useState({});
  const toast = useToast();

  const fetchAlerts = async (pageNum = 1, append = false) => {
    setLoading(true);
    setError("");
    try {
      const params = { page: pageNum, limit: 20 };
      if (filter) params.feedback_status = filter;
      const res = await api.get("/alerts", { params });
      const payload = asObject(res.data);
      const incoming = asArray(payload.alerts);
      setAlerts(prev => (append ? [...prev, ...incoming] : incoming));
      setTotalPages(Math.max(1, asNumber(payload.total_pages, 1)));
    } catch (err) {
      if (!append) setAlerts([]);
      setError(err?.message || "Failed to load alerts");
      toast({ title: "Error loading alerts", status: "error" });
    }
    setLoading(false);
  };

  useEffect(() => {
    setAlerts([]);
    setPage(1);
    fetchAlerts(1, false);
    api.get("/users")
      .then(res => setUsers(asArray(res.data)))
      .catch(() => setUsers([]));
    // eslint-disable-next-line
  }, [filter]);

  useEffect(() => {
    if (page === 1) return;
    fetchAlerts(page, true);
    // eslint-disable-next-line
  }, [page]);

  // The server already applied the feedback filter across the full result set.
  const filtered = alerts;
  const exportCols = ALL_COLUMNS.filter(c => selectedColumns.includes(c.key));

  const formatCell = (row, column) =>
    column.key === "timestamp"
      ? formatDate(row[column.key], dateFormat)
      : String(row[column.key] ?? "");

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

  const runAlertAction = (request, failureTitle) =>
    request
      .then(() => fetchAlerts(1, false))
      .catch(() => toast({ title: failureTitle, status: "error" }));

  const assignAlert = (alertId, userId) =>
    runAlertAction(
      api.post(`/alerts/${alertId}/assign`, { user_id: userId }),
      "Failed to assign alert"
    );
  const updateStatus = (alertId, status) =>
    runAlertAction(
      api.post(`/alerts/${alertId}/status`, { status }),
      "Failed to update status"
    );
  // The verdict is what analytics and model tuning learn from; status is only
  // where the alert is in the workflow.
  const updateVerdict = (alert, feedbackStatus) =>
    runAlertAction(
      api.post(`/alerts/${alert.id}/status`, { status: alert.status, feedback_status: feedbackStatus }),
      "Failed to record verdict"
    );
  const addComment = (alertId, commentText) => {
    if (!commentText || !commentText.trim()) return;
    runAlertAction(
      api.post(`/alerts/${alertId}/comment`, { comment: commentText.trim() }),
      "Failed to add comment"
    );
    setCommentDrafts(prev => ({ ...prev, [alertId]: "" }));
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
        <Button colorScheme="green" onClick={() => exportCSV(filtered, "alerts.csv", exportCols, formatCell)}>Export CSV</Button>
        <Button colorScheme="blue" onClick={() => exportExcel(filtered, "alerts.xlsx", exportCols, "Alerts", formatCell)}>Export Excel</Button>
        <Button colorScheme="red" onClick={() => exportPDF(filtered, "alerts.pdf", exportCols, formatCell)}>Export PDF</Button>
      </HStack>
      <Table variant="simple">
        <Thead>
          <Tr>
            {exportCols.map(col => <Th key={col.key}>{col.label}</Th>)}
            <Th>Assigned To</Th>
            <Th>Status</Th>
            <Th>Verdict</Th>
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
                <Select size="xs" aria-label={`Status for ${alert.plate_number}`} value={alert.status} onChange={e => updateStatus(alert.id, e.target.value)}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="closed">Closed</option>
                </Select>
              </Td>
              <Td>
                <Select
                  size="xs"
                  aria-label={`Verdict for ${alert.plate_number}`}
                  value={alert.feedback_status}
                  onChange={e => updateVerdict(alert, e.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="false_alarm">False alarm</option>
                  <option value="investigated">Investigated</option>
                  <option value="escalated">Escalated</option>
                </Select>
              </Td>
              <Td>
                <Box maxW="240px">
                  {asArray(alert.comments).map(c => (
                    <Box key={c.id} mb={1} fontSize="xs">
                      <Box as="span" fontWeight="bold">{c.author_email || "Unknown"}</Box>
                      <Box as="span" color="gray.500"> · {formatDate(c.created_at, "datetime")}</Box>
                      <Box whiteSpace="pre-wrap">{c.body}</Box>
                    </Box>
                  ))}
                </Box>
                <Textarea
                  size="xs"
                  value={commentDrafts[alert.id] || ""}
                  onChange={e => setCommentDrafts(prev => ({ ...prev, [alert.id]: e.target.value }))}
                  placeholder="Add comment..."
                />
                <Button
                  size="xs"
                  mt={1}
                  isDisabled={!(commentDrafts[alert.id] || "").trim()}
                  onClick={() => addComment(alert.id, commentDrafts[alert.id])}
                >
                  Add
                </Button>
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