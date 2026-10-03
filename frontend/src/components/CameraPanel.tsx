import React, { useEffect, useRef, useState } from 'react';
import {
  Badge, Box, Button, Card, CardBody, CardHeader, Flex, Grid, Heading, HStack, Icon, Text, VStack,
  useColorModeValue,
} from '@chakra-ui/react';
import { FiCamera, FiEye } from 'react-icons/fi';
import api from '../api';
import { asArray } from '../utils/safe';

interface Camera {
  id: string;
  name: string;
  online: boolean;
  last_frame_at: number;
}

const LIST_POLL_MS = 5000;
const FRAME_POLL_MS = 1000;

/*
 * Live previews published by the vision service. Frames are fetched with the
 * guard's own session (never a bare <img src>), so no camera is reachable
 * without signing in, and camera hosts are never exposed to browsers.
 */
const CameraPanel: React.FC = () => {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get('/cameras')
        .then(res => {
          if (cancelled) return;
          const list = asArray<Camera>(res.data);
          setCameras(list);
          setSelected(prev => prev ?? list.find(c => c.online)?.id ?? list[0]?.id ?? null);
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setLoaded(true));
    load();
    const timer = setInterval(load, LIST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Poll frames only while the camera is reporting; the list refresh brings
  // it back when it returns.
  const selectedOnline = cameras.find(c => c.id === selected)?.online ?? false;

  useEffect(() => {
    setFrameUrl(null);
    if (!selected || !selectedOnline) return;
    let cancelled = false;
    let current: string | null = null;
    const fetchFrame = () =>
      api
        .get(`/cameras/${encodeURIComponent(selected)}/frame`, { responseType: 'blob' })
        .then(res => {
          if (cancelled) return;
          const next = URL.createObjectURL(res.data as Blob);
          if (current) URL.revokeObjectURL(current);
          current = next;
          setFrameUrl(next);
        })
        .catch(() => {
          if (cancelled) return;
          if (current) URL.revokeObjectURL(current);
          current = null;
          setFrameUrl(null);
        });
    fetchFrame();
    const timer = setInterval(fetchFrame, FRAME_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (current) URL.revokeObjectURL(current);
    };
  }, [selected, selectedOnline]);

  const camera = cameras.find(c => c.id === selected);

  return (
    <Card bg={bgColor} border="1px" borderColor={borderColor} mb={8}>
      <CardHeader>
        <Flex justify="space-between" align="center">
          <Heading size="md">Live Camera Feeds</Heading>
          <Button
            variant="neumorphic"
            size="sm"
            leftIcon={<FiEye />}
            isDisabled={!frameUrl}
            onClick={() => viewRef.current?.requestFullscreen?.()}
          >
            Fullscreen
          </Button>
        </Flex>
      </CardHeader>
      <CardBody>
        <Grid templateColumns={{ base: '1fr', lg: '3fr 1fr' }} gap={6}>
          <Box
            ref={viewRef}
            position="relative"
            bg="gray.900"
            borderRadius="xl"
            overflow="hidden"
            // Full height only with a picture; an empty black box pushed the
            // alerts off the first screen.
            minH={frameUrl ? '400px' : '160px'}
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            {frameUrl ? (
              <img
                src={frameUrl}
                alt={`Live view: ${camera?.name ?? selected}`}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <VStack spacing={3} color="gray.400" p={6} textAlign="center">
                <Icon as={FiCamera} w={16} h={16} />
                <Text fontSize="lg" fontWeight="bold">
                  {!loaded ? 'Loading cameras…' : camera ? `${camera.name} is offline` : 'No cameras reporting'}
                </Text>
                <Text fontSize="sm">
                  {camera
                    ? 'No frame received recently. Check the camera and the vision service.'
                    : 'Cameras appear here once the vision service is running.'}
                </Text>
              </VStack>
            )}
          </Box>

          <VStack spacing={4} align="stretch">
            <Text fontWeight="bold" color="gray.700">Cameras</Text>
            {cameras.map(c => (
              <Box
                as="button"
                key={c.id}
                p={4}
                border="1px"
                borderColor={borderColor}
                borderRadius="lg"
                textAlign="left"
                bg={selected === c.id ? 'blue.50' : bgColor}
                aria-pressed={selected === c.id}
                onClick={() => setSelected(c.id)}
              >
                <HStack justify="space-between">
                  <Text fontWeight="semibold" fontSize="sm">{c.name}</Text>
                  <Badge colorScheme={c.online ? 'green' : 'red'} variant="subtle">
                    {c.online ? 'online' : 'offline'}
                  </Badge>
                </HStack>
              </Box>
            ))}
            {loaded && cameras.length === 0 && (
              <Text fontSize="sm" color="gray.500">None yet.</Text>
            )}
          </VStack>
        </Grid>
      </CardBody>
    </Card>
  );
};

export default CameraPanel;
