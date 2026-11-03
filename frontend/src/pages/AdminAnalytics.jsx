import React, { useEffect, useState } from "react";
import { Box, Heading, Stat, StatLabel, StatNumber, SimpleGrid, Progress, Input, Button, Flex, Select, Spinner, Alert } from "@chakra-ui/react";
import api from "../api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend } from "recharts";
import { useAuth } from "../context/AuthContext";
import { asArray, asObject, asNumber } from "../utils/safe";
import { exportCSV, exportExcel, exportPDF, formatDate } from "../utils/exporters";

const FEEDBACK_COLORS = ["#f6ad55", "#4299e1", "#f56565"];

const MISMATCH_COLUMNS = [{ key: "date", label: "Date" }, { key: "count", label: "Count" }];
const COMMON_COLUMNS = [{ key: "type", label: "Type" }, { key: "count", label: "Count" }];

// Only the "date" column needs date formatting; everything else is passed through.
const formatCell = (row, column) =>
  column.key === "date" ? formatDate(row[column.key]) : String(row[column.key] ?? "");

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
      api.get("/sites")
        .then(res => setSites(asArray(res.data)))
        .catch(() => setSites([]));
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
        api.get("/analytics/mismatches", { params }),
        api.get("/analytics/common-mismatches", { params }),
        api.get("/analytics/average-confidence", { params }),
        api.get("/analytics/feedback-stats", { params }),
        api.get("/analytics/time-to-resolution", { params }),
        api.get("/analytics/escalation-rate", { params })
      ]);
      // Coerce every value: charts throw on a non-array and take the page down.
      setMismatches(asArray(mismatchRes.data));
      setCommon(asArray(commonRes.data));
      setConfidence(asObject(confRes.data));
      setFeedback(asObject(feedbackRes.data));
      setTimeToResolution(asNumber(asObject(timeRes.data).average_time_to_resolution_minutes));
      setEscalationRate(asNumber(asObject(escRes.data).escalation_rate_percent));
    } catch (err) {
      setMismatches([]);
      setCommon([]);
      setConfidence({});
      setFeedback({});
      setTimeToResolution(0);
      setEscalationRate(0);
      setError(err?.message || "Failed to load analytics");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line
  }, [siteId]);

  const plateConfidence = asNumber(confidence.average_plate_confidence);
  const typeConfidence = asNumber(confidence.average_type_confidence);

  const feedbackData = [
    { name: "False Alarms", value: asNumber(feedback.false_alarms) },
    { name: "Investigated", value: asNumber(feedback.investigated) },
    { name: "Escalated", value: asNumber(feedback.escalated) }
  ];

  return (
    <Box p={6}>
      <Heading mb={4}>Analytics Dashboard</Heading>
      <Flex mb={4} gap={3} wrap="wrap" align="center">
        {user?.role === "admin" && (
          <Select value={siteId} onChange={e => setSiteId(e.target.value)} width="200px" placeholder="All Sites">
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </Select>
        )}
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From" width="150px" />
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To" width="150px" />
        <Button colorScheme="blue" onClick={fetchAnalytics}>Filter</Button>
        <Button colorScheme="green" onClick={() => exportCSV(mismatches, "mismatches.csv", MISMATCH_COLUMNS, formatCell)}>Export Mismatches CSV</Button>
        <Button colorScheme="green" onClick={() => exportCSV(common, "common_mismatches.csv", COMMON_COLUMNS, formatCell)}>Export Common CSV</Button>
        <Button colorScheme="green" onClick={() => exportExcel(mismatches, "mismatches.xlsx", MISMATCH_COLUMNS, "Mismatches", formatCell)}>Export Mismatches Excel</Button>
        <Button colorScheme="green" onClick={() => exportExcel(common, "common_mismatches.xlsx", COMMON_COLUMNS, "Common Mismatches", formatCell)}>Export Common Excel</Button>
        <Button colorScheme="green" onClick={() => exportPDF(mismatches, "mismatches.pdf", MISMATCH_COLUMNS, formatCell)}>Export Mismatches PDF</Button>
        <Button colorScheme="green" onClick={() => exportPDF(common, "common_mismatches.pdf", COMMON_COLUMNS, formatCell)}>Export Common PDF</Button>
      </Flex>
      {loading && <Spinner mt={4} />}
      {error && <Alert status="error" mb={4}>{error}</Alert>}
      <SimpleGrid columns={2} spacing={6} mb={6}>
        <Stat>
          <StatLabel>Avg Plate Confidence</StatLabel>
          <StatNumber>{plateConfidence ? plateConfidence.toFixed(2) : "—"}</StatNumber>
          <Progress value={plateConfidence * 100} size="sm" colorScheme="blue" />
        </Stat>
        <Stat>
          <StatLabel>Avg Type Confidence</StatLabel>
          <StatNumber>{typeConfidence ? typeConfidence.toFixed(2) : "—"}</StatNumber>
          <Progress value={typeConfidence * 100} size="sm" colorScheme="green" />
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