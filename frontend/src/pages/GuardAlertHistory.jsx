import React, { useEffect, useState, useRef, useCallback } from "react";
import { Badge, Box, Card, Flex, Heading, Input, Table, Thead, Tbody, Tr, Th, Td, Select, Button, HStack, Spinner, Text, useToast, Menu, MenuButton, MenuList, MenuItem, MenuOptionGroup, MenuItemOption, MenuDivider } from "@chakra-ui/react";
import { FiChevronDown, FiColumns, FiDownload } from "react-icons/fi";
import api from "../api";
import { asArray, asObject, asNumber } from "../utils/safe";
import { exportCSV, exportExcel, exportPDF, formatDate } from "../utils/exporters";
import { mismatchLabel, mismatchScheme } from "../utils/labels";
const ALL_COLUMNS = [
  { key: "plate_number", label: "Plate" },
  { key: "mismatch_type", label: "Reason" },
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
  const [selectedColumns, setSelectedColumns] = useState(ALL_COLUMNS.filter(c => c.key !== "feedback_status").map(c => c.key));
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

  // One formatter for screen and export, so both read the same.
  const formatCell = (row, column) => {
    const value = row[column.key];
    if (column.key === "timestamp") return formatDate(value, dateFormat);
    if (column.key === "mismatch_type") return mismatchLabel(String(value ?? ""));
    if (column.key === "plate_confidence") return typeof value === "number" ? `${Math.round(value * 100)}%` : "";
    return String(value ?? "");
  };

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
    <Box p={{ base: 4, md: 8 }} maxW="7xl" mx="auto">
      <Heading size="lg" mb={1}>Alert history</Heading>
      <Text color="text.muted" mb={4}>Every camera read, newest first. Set the verdict and leave notes for the next shift.</Text>
      <Flex mb={4} gap={3} wrap="wrap" align="center">
        <Select value={filter} onChange={e => setFilter(e.target.value)} width="200px" aria-label="Filter by verdict">
          <option value="">All verdicts</option>
          <option value="pending">Pending</option>
          <option value="false_alarm">False alarm</option>
          <option value="investigated">Investigated</option>
          <option value="escalated">Escalated</option>
        </Select>
        <Select value={dateFormat} onChange={e => setDateFormat(e.target.value)} width="160px" aria-label="Date format">
          <option value="datetime">Date and time</option>
          <option value="date">Date only</option>
          <option value="time">Time only</option>
        </Select>
        <Box flex={1} />
        <Menu closeOnSelect={false}>
          <MenuButton as={Button} variant="neumorphic" leftIcon={<FiColumns />} rightIcon={<FiChevronDown />}>
            Columns
          </MenuButton>
          <MenuList>
            <MenuOptionGroup type="checkbox" value={selectedColumns} onChange={setSelectedColumns}>
              {ALL_COLUMNS.map(col => (
                <MenuItemOption key={col.key} value={col.key}>{col.label}</MenuItemOption>
              ))}
            </MenuOptionGroup>
          </MenuList>
        </Menu>
        <Menu>
          <MenuButton as={Button} colorScheme="brand" leftIcon={<FiDownload />} rightIcon={<FiChevronDown />}>
            Export
          </MenuButton>
          <MenuList>
            <MenuItem onClick={() => exportCSV(filtered, "alerts.csv", exportCols, formatCell)}>CSV</MenuItem>
            <MenuItem onClick={() => exportExcel(filtered, "alerts.xlsx", exportCols, "Alerts", formatCell)}>Excel</MenuItem>
            <MenuDivider />
            <MenuItem onClick={() => exportPDF(filtered, "alerts.pdf", exportCols, formatCell)}>PDF</MenuItem>
          </MenuList>
        </Menu>
      </Flex>
      {error && <Box color="red.600" mb={3}>{error}</Box>}
      <Card overflowX="auto">
        <Table size="sm">
          <Thead>
            <Tr>
              {exportCols.map(col => <Th key={col.key}>{col.label}</Th>)}
              <Th>Assigned to</Th>
              <Th>Status</Th>
              <Th>Verdict</Th>
              <Th minW="260px">Notes</Th>
            </Tr>
          </Thead>
          <Tbody>
            {filtered.length === 0 && !loading && (
              <Tr><Td colSpan={exportCols.length + 4}><Text color="text.muted" py={6} textAlign="center">No alerts match this filter.</Text></Td></Tr>
            )}
            {filtered.map((alert, i) => (
              <Tr key={alert.id} ref={i === filtered.length - 1 ? lastAlertRef : null} verticalAlign="top">
                {exportCols.map(col => (
                  <Td key={col.key} whiteSpace="nowrap" fontFamily={col.key === "plate_number" ? "mono" : undefined} fontWeight={col.key === "plate_number" ? "bold" : undefined}>
                    {col.key === "mismatch_type"
                      ? <Badge colorScheme={mismatchScheme(alert.mismatch_type)}>{formatCell(alert, col)}</Badge>
                      : formatCell(alert, col)}
                  </Td>
                ))}
                <Td>
                  <Menu>
                    <MenuButton as={Button} size="sm" variant="neumorphic" rightIcon={<FiChevronDown />}>
                      {users.find(u => u.id === alert.assigned_to)?.full_name || "Assign"}
                    </MenuButton>
                    <MenuList>
                      {users.map(u => <MenuItem key={u.id} onClick={() => assignAlert(alert.id, u.id)}>{u.full_name}</MenuItem>)}
                    </MenuList>
                  </Menu>
                </Td>
                <Td>
                  <Select size="sm" minW="130px" aria-label={`Status for ${alert.plate_number}`} value={alert.status} onChange={e => updateStatus(alert.id, e.target.value)}>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="closed">Closed</option>
                  </Select>
                </Td>
                <Td>
                  <Select
                    size="sm"
                    minW="140px"
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
                  {asArray(alert.comments).map(c => (
                    <Box key={c.id} mb={2} fontSize="sm">
                      <Box as="span" fontWeight="semibold">{c.author_email || "Unknown"}</Box>
                      <Box as="span" color="text.muted"> · {formatDate(c.created_at, "datetime")}</Box>
                      <Box whiteSpace="pre-wrap">{c.body}</Box>
                    </Box>
                  ))}
                  <HStack>
                    <Input
                      size="sm"
                      aria-label={`Note for ${alert.plate_number}`}
                      value={commentDrafts[alert.id] || ""}
                      onChange={e => setCommentDrafts(prev => ({ ...prev, [alert.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") addComment(alert.id, commentDrafts[alert.id]); }}
                      placeholder="Add a note…"
                    />
                    <Button
                      size="sm"
                      isDisabled={!(commentDrafts[alert.id] || "").trim()}
                      onClick={() => addComment(alert.id, commentDrafts[alert.id])}
                    >
                      Add
                    </Button>
                  </HStack>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
      {loading && <Spinner mt={4} />}
    </Box>
  );
}
