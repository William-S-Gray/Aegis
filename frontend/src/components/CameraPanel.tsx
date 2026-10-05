import React, { useEffect, useRef, useState } from 'react';
import {
  Badge, Box, Button, Card, CardBody, CardHeader, Flex, Grid, Heading, HStack, Icon, Text, VStack,
  useToast,
} from '@chakra-ui/react';
import { FiCamera, FiEye, FiRefreshCw, FiSmartphone } from 'react-icons/fi';
import api from '../api';
import { apiMessage, asArray } from '../utils/safe';
import { poll } from '../utils/poll';

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
interface Props {
  /** Opens the device scanner: the fallback when no gate camera is working. */
  onScanWithDevice?: () => void;
}

const CameraPanel: React.FC<Props> = ({ onScanWithDevice }) => {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const bgColor = 'bg.surface';
  const borderColor = 'border.default';

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
    const stop = poll(load, LIST_POLL_MS);
    return () => {
      cancelled = true;
      stop();
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
    const stop = poll(fetchFrame, FRAME_POLL_MS);
    return () => {
      cancelled = true;
      stop();
      if (current) URL.revokeObjectURL(current);
    };
  }, [selected, selectedOnline]);

  const camera = cameras.find(c => c.id === selected);
  const toast = useToast();
  const [restarting, setRestarting] = useState(false);

  // The vision service at the gate collects the request within seconds and
  // reconnects the camera (or starts one whose reader stopped).
  const restart = async (cameraId?: string) => {
    setRestarting(true);
    try {
      await api.post(cameraId ? `/cameras/${encodeURIComponent(cameraId)}/restart` : '/cameras/restart');
      toast({
        title: cameraId ? 'Camera restart requested' : 'Restart requested for all cameras',
        description: 'The gate system reconnects within about 10 seconds. If nothing appears, check the camera and its power.',
        status: 'info',
      });
    } catch (error) {
      toast({ title: 'Restart not sent', description: apiMessage(error, 'Please try again'), status: 'error' });
    } finally {
      setRestarting(false);
    }
  };

  return (
    <Card bg={bgColor} border="1px" borderColor={borderColor} mb={8}>
      <CardHeader>
        <Flex justify="space-between" align="center">
          <Heading size="md">Live Camera Feeds</Heading>
          <HStack>
          {cameras.length > 0 && (
            <Button variant="neumorphic" size="sm" leftIcon={<FiRefreshCw />} onClick={() => restart()} isLoading={restarting}>
              Restart all
            </Button>
          )}
          <Button
            variant="neumorphic"
            size="sm"
            leftIcon={<FiEye />}
            isDisabled={!frameUrl}
            onClick={() => viewRef.current?.requestFullscreen?.()}
          >
            Fullscreen
          </Button>
          </HStack>
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
              <VStack spacing={3} color="text.subtle" p={6} textAlign="center">
                <Icon as={FiCamera} w={16} h={16} />
                <Text fontSize="lg" fontWeight="bold">
                  {!loaded ? 'Loading cameras…' : camera ? `${camera.name} is offline` : 'No cameras reporting'}
                </Text>
                <Text fontSize="sm">
                  {camera
                    ? 'No picture received recently. Restart it, or scan with this device meanwhile.'
                    : "If a camera hasn't started, restart the cameras, or scan with this device meanwhile."}
                </Text>
                {loaded && (
                  <HStack spacing={3} pt={2} flexWrap="wrap" justify="center">
                    <Button
                      size="sm"
                      leftIcon={<FiRefreshCw />}
                      onClick={() => restart(camera?.id)}
                      isLoading={restarting}
                    >
                      {camera ? 'Restart this camera' : 'Restart cameras'}
                    </Button>
                    {onScanWithDevice && (
                      <Button size="sm" colorScheme="brand" leftIcon={<FiSmartphone />} onClick={onScanWithDevice}>
                        Scan with this device
                      </Button>
                    )}
                  </HStack>
                )}
              </VStack>
            )}
          </Box>

          <VStack spacing={4} align="stretch">
            <Text fontWeight="bold" color="text.default">Cameras</Text>
            {cameras.map(c => (
              <Box
                as="button"
                key={c.id}
                p={4}
                border="1px"
                borderColor={borderColor}
                borderRadius="lg"
                textAlign="left"
                bg={selected === c.id ? 'tint-blue' : bgColor}
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
              <Text fontSize="sm" color="text.muted">None yet.</Text>
            )}
          </VStack>
        </Grid>
      </CardBody>
    </Card>
  );
};

export default CameraPanel;
