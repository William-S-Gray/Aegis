import React, { useEffect, useState } from "react";
import { Box, Heading, Stat, StatLabel, StatNumber, SimpleGrid, Table, Thead, Tbody, Tr, Th, Td, Progress, Input, Button, HStack, Select, Spinner, Alert } from "@chakra-ui/react";
import axios from "axios";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend, Scatter } from "recharts";
import { useAuth } from "../context/AuthContext";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

const FEEDBACK_COLORS = ["#f6ad55", "#4299e1", "#f56565"];

function exportCSV(data, filename, columns, dateFormat) {
  if (!data.length) return;
  const header = columns.map(c => c.label).join(",");
  const rows = data.map(row => columns.map(c => c.key === "date" ? formatDate(row[c.key], dateFormat) : row[c.key]).join(","));
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
  if (!data.length) return;
  const rows = data.map(row => {
    const obj = {};
    columns.forEach(c => {
      obj[c.label] = c.key === "date" ? formatDate(row[c.key], dateFormat) : row[c.key];
    });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Analytics");
  XLSX.writeFile(wb, filename);
}

function exportPDF(data, filename, columns, dateFormat) {
  if (!data.length) return;
  const doc = new jsPDF();
  doc.autoTable({
    head: [columns.map(c => c.label)],
    body: data.map(a => columns.map(c => c.key === "date" ? formatDate(a[c.key], dateFormat) : a[c.key]))
  });
  doc.save(filename);
}

function formatDate(date, format) {
  const d = new Date(date);
  if (format === "date") return d.toLocaleDateString();
  if (format === "time") return d.toLocaleTimeString();
  return d.toLocaleString();
}

export default function AdminAnalytics() {
  const { user } = useAuth();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState("");
  const [mismatches, setMismatches] = useState([]);
  const [common, setCommon] = useState([]);
  const [confidence, setConfidence] = useState({});
  const [feedback, setFeedback] = useState({});
  const [timeToResolution, setTimeToResolution] = useState(0);
  const [escalationRate, setEscalationRate] = useState(0);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.role === "admin") {
      axios.get("/api/v1/sites").then(res => setSites(res.data));
    }
  }, [user]);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (siteId) params.site_id = siteId;
      const [mismatchRes, commonRes, confRes, feedbackRes, timeRes, escRes] = await Promise.all([
        axios.get("/api/v1/analytics/mismatches", { params }),
        axios.get("/api/v1/analytics/common-mismatches", { params }),
        axios.get("/api/v1/analytics/average-confidence", { params }),
        axios.get("/api/v1/analytics/feedback-stats", { params }),
        axios.get("/api/v1/analytics/time-to-resolution", { params }),
        axios.get("/api/v1/analytics/escalation-rate", { params })
      ]);
      setMismatches(mismatchRes.data);
      setCommon(commonRes.data);
      setConfidence(confRes.data);
      setFeedback(feedbackRes.data);
      setTimeToResolution(timeRes.data.average_time_to_resolution_minutes);
      setEscalationRate(escRes.data.escalation_rate_percent);
    } catch (err) {
      setError("Failed to load analytics");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line
  }, [siteId]);

  const feedbackData = [
    { name: "False Alarms", value: feedback.false_alarms || 0 },
    { name: "Investigated", value: feedback.investigated || 0 },
    { name: "Escalated", value: feedback.escalated || 0 }
  ];

  return (
    <Box p={6}>
      <Heading mb={4}>Analytics Dashboard</Heading>
      <HStack mb={4} spacing={4}>
        {user?.role === "admin" && (
          <Select value={siteId} onChange={e => setSiteId(e.target.value)} width="200px" placeholder="All Sites">
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </Select>
        )}
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From" width="150px" />
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To" width="150px" />
        <Button colorScheme="blue" onClick={fetchAnalytics}>Filter</Button>
        <Button colorScheme="green" onClick={() => exportCSV(mismatches, "mismatches.csv", [{key: "date", label: "Date"}, {key: "count", label: "Count"}], "date")}>Export Mismatches CSV</Button>
        <Button colorScheme="green" onClick={() => exportCSV(common, "common_mismatches.csv", [{key: "type", label: "Type"}, {key: "count", label: "Count"}], "date")}>Export Common CSV</Button>
        <Button colorScheme="green" onClick={() => exportExcel(mismatches, "mismatches.xlsx", [{key: "date", label: "Date"}, {key: "count", label: "Count"}], "date")}>Export Mismatches Excel</Button>
        <Button colorScheme="green" onClick={() => exportExcel(common, "common_mismatches.xlsx", [{key: "type", label: "Type"}, {key: "count", label: "Count"}], "date")}>Export Common Excel</Button>
        <Button colorScheme="green" onClick={() => exportPDF(mismatches, "mismatches.pdf", [{key: "date", label: "Date"}, {key: "count", label: "Count"}], "date")}>Export Mismatches PDF</Button>
        <Button colorScheme="green" onClick={() => exportPDF(common, "common_mismatches.pdf", [{key: "type", label: "Type"}, {key: "count", label: "Count"}], "date")}>Export Common PDF</Button>
      </HStack>
      {loading && <Spinner mt={4} />}
      {error && <Alert status="error" mb={4}>{error}</Alert>}
      <SimpleGrid columns={2} spacing={6} mb={6}>
        <Stat>
          <StatLabel>Avg Plate Confidence</StatLabel>
          <StatNumber>{confidence.average_plate_confidence}</StatNumber>
          <Progress value={confidence.average_plate_confidence * 100} size="sm" colorScheme="blue" />
        </Stat>
        <Stat>
          <StatLabel>Avg Type Confidence</StatLabel>
          <StatNumber>{confidence.average_type_confidence}</StatNumber>
          <Progress value={confidence.average_type_confidence * 100} size="sm" colorScheme="green" />
        </Stat>
        <Stat>
          <StatLabel>Avg Time to Resolution (min)</StatLabel>
          <StatNumber>{timeToResolution}</StatNumber>
        </Stat>
        <Stat>
          <StatLabel>Escalation Rate (%)</StatLabel>
          <StatNumber>{escalationRate}</StatNumber>
        </Stat>
      </SimpleGrid>
      <Heading size="md" mb={2}>Mismatches Over Time</Heading>
      <LineChart width={500} height={250} data={mismatches} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="count" stroke="#3182ce" />
      </LineChart>
      <Heading size="md" mb={2} mt={6}>Most Common Mismatches</Heading>
      <BarChart width={500} height={250} data={common} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="type" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="count" fill="#f56565" />
      </BarChart>
      <Heading size="md" mb={2} mt={6}>Feedback Stats</Heading>
      <PieChart width={400} height={250}>
        <Pie data={feedbackData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
          {feedbackData.map((entry, idx) => <Cell key={`cell-${idx}`} fill={FEEDBACK_COLORS[idx % FEEDBACK_COLORS.length]} />)}
        </Pie>
        <Legend />
        <Tooltip />
      </PieChart>
    </Box>
  );
} 