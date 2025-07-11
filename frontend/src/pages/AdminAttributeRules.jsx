import React, { useEffect, useState } from "react";
import { Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Button, Select, Input, useToast } from "@chakra-ui/react";
import axios from "axios";

const ATTRIBUTES = ["type", "color"];

export default function AdminAttributeRules() {
  const [rules, setRules] = useState([]);
  const [attribute, setAttribute] = useState("type");
  const [pair1, setPair1] = useState("");
  const [pair2, setPair2] = useState("");
  const toast = useToast();

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    const res = await axios.get("/api/v1/attribute-mismatch-rules");
    setRules(res.data);
  };

  const addRule = async () => {
    if (!pair1 || !pair2) return;
    await axios.post("/api/v1/attribute-mismatch-rules", {
      attribute,
      allowed_pair: [pair1, pair2],
    });
    setPair1("");
    setPair2("");
    fetchRules();
    toast({ title: "Rule added", status: "success" });
  };

  const deleteRule = async (id) => {
    await axios.delete(`/api/v1/attribute-mismatch-rules/${id}`);
    fetchRules();
    toast({ title: "Rule deleted", status: "info" });
  };

  return (
    <Box p={6}>
      <Heading mb={4}>Attribute Mismatch Rules</Heading>
      <Box mb={4} display="flex" gap={2}>
        <Select value={attribute} onChange={e => setAttribute(e.target.value)} width="120px">
          {ATTRIBUTES.map(attr => <option key={attr} value={attr}>{attr}</option>)}
        </Select>
        <Input placeholder="Value 1" value={pair1} onChange={e => setPair1(e.target.value)} width="120px" />
        <Input placeholder="Value 2" value={pair2} onChange={e => setPair2(e.target.value)} width="120px" />
        <Button colorScheme="blue" onClick={addRule}>Add Rule</Button>
      </Box>
      <Table variant="simple">
        <Thead>
          <Tr>
            <Th>Attribute</Th>
            <Th>Allowed Pair</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rules.map(rule => (
            <Tr key={rule.id}>
              <Td>{rule.attribute}</Td>
              <Td>{rule.allowed_pair.join(" ↔ ")}</Td>
              <Td><Button colorScheme="red" size="sm" onClick={() => deleteRule(rule.id)}>Delete</Button></Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
} 