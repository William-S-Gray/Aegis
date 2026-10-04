import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  useToast,
} from '@chakra-ui/react';
import { FiCamera, FiRefreshCw } from 'react-icons/fi';
import api from '../api';
import { apiMessage } from '../utils/safe';
import { mismatchLabel } from '../utils/labels';
import { extractPlate } from '../utils/plateText';

// The API refuses a photo over 90 000 base64 characters (~64 KB of JPEG).
const MAX_PHOTO_CHARS = 88_000;

type Reader = { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }> };

// One reader per page: loading it (~7 MB, then cached) is the slow part.
let readerPromise: Promise<Reader> | null = null;

function loadReader(): Promise<Reader> {
  readerPromise ??= import('tesseract.js')
    .then(async (mod) => {
      // The browser build exports one default object (no named exports).
      const { createWorker, OEM, PSM } = (mod as unknown as { default?: typeof mod }).default ?? mod;
      // Served by Aegis itself (scripts/copy-ocr.mjs): no third-party CDN.
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr',
        langPath: '/ocr',
        workerBlobURL: false,
      });
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -',
        // Automatic layout. Sparse-text mode missed any plate with a border
        // (measured in Chrome), and real plates have one.
        tessedit_pageseg_mode: PSM.AUTO,
      });
      return worker as unknown as Reader;
    })
    .catch((error) => {
      readerPromise = null; // let the next press try again
      throw error;
    });
  return readerPromise;
}

// Hand-held photos are tilted; a few degrees off and nothing is read at all.
// Tried in order until a plate turns up (measured: up to 10 degrees of tilt
// read correctly in 1-4 s).
const ANGLES = [0, -4, 4, -8, 8, -12, 12];
// Larger photos only make reading slower.
const READ_WIDTH = 1280;

function prepared(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const scale = Math.min(1, READ_WIDTH / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const g = canvas.getContext('2d');
  if (!g) return source;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate((degrees * Math.PI) / 180);
  g.drawImage(source, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  return canvas;
}

/** The plate in a photo, trying small rotations; '' when none is found. */
async function readPlate(reader: Reader, photo: HTMLCanvasElement): Promise<string> {
  for (const degrees of ANGLES) {
    const { data } = await reader.recognize(prepared(photo, degrees));
    const plate = extractPlate(data.text);
    if (plate) return plate;
  }
  return '';
}

/** A JPEG small enough for the API, as base64 without the data: prefix. */
function photoForUpload(source: HTMLCanvasElement): string {
  const canvas = document.createElement('canvas');
  for (const width of [800, 640, 480, 360]) {
    canvas.width = Math.min(width, source.width);
    canvas.height = Math.round((source.height * canvas.width) / source.width);
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.7, 0.5, 0.35]) {
      const data = (canvas.toDataURL('image/jpeg', quality) || '').split(',', 2)[1] ?? '';
      if (data.length <= MAX_PHOTO_CHARS) return data;
    }
  }
  return '';
}

function cameraError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Camera access was refused. Allow the camera for this site in your browser settings, then try again.';
  if (name === 'NotFoundError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
  return 'The camera could not be started on this device.';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Scan a plate with this device's own camera: a backup when a gate camera is
 * down, and a way to check a vehicle the cameras cannot see. The plate is read
 * on the device; the guard confirms it, and it is checked like any camera read,
 * with the photo kept as evidence.
 */
const DeviceScanner: React.FC<Props> = ({ isOpen, onClose }) => {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  // Taken, whether or not a preview could be drawn.
  const [hasPhoto, setHasPhoto] = useState(false);
  const [plate, setPlate] = useState('');
  const [reading, setReading] = useState(false);
  const [sending, setSending] = useState(false);
  // Bumped when a stream starts, so the effect below attaches it to the video.
  const [streamVersion, setStreamVersion] = useState(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError('');
    setPhotoUrl('');
    setHasPhoto(false);
    setPlate('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera here. It needs a secure (https) page.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The back camera on a phone; any camera elsewhere.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setStreamVersion((v) => v + 1);
    } catch (e) {
      setError(cameraError(e));
    }
  }, []);

  // The video element only exists while there is no photo (and after Retake
  // it is mounted again), so attach the stream once it is on screen.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || hasPhoto || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.play().catch(() => undefined);
  }, [hasPhoto, streamVersion]);

  useEffect(() => {
    if (!isOpen) return;
    startCamera();
    // Start loading the reader while the guard aims.
    loadReader().catch(() => undefined);
    return stopCamera;
  }, [isOpen, startCamera, stopCamera]);

  const takePhoto = async () => {
    const video = videoRef.current;
    // A camera still starting (or a hidden tab) yields an empty or tiny frame.
    if (!video || video.videoWidth < 160 || video.readyState < 2) {
      toast({ title: 'The camera is not ready yet', description: 'Wait a moment for the picture to appear, then try again.', status: 'info' });
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    shotRef.current = canvas;
    setPhotoUrl(canvas.toDataURL('image/jpeg', 0.8) || '');
    setHasPhoto(true);
    stopCamera();

    setReading(true);
    try {
      const reader = await loadReader();
      const found = await readPlate(reader, canvas);
      setPlate(found);
      if (!found) toast({ title: 'No plate found in the photo', description: 'Type it in, or retake the photo closer.', status: 'info' });
    } catch {
      toast({ title: 'Could not read the photo', description: 'Type the plate in instead.', status: 'warning' });
    } finally {
      setReading(false);
    }
  };

  const check = async () => {
    if (!plate.trim()) return;
    setSending(true);
    try {
      let photo = '';
      try {
        photo = shotRef.current ? photoForUpload(shotRef.current) : '';
      } catch {
        // Evidence is a bonus: a photo that cannot be encoded must not stop the check.
      }
      // Raised like a camera read, so it is classified against the register and
      // appears at the gate for a decision; the photo is kept as evidence.
      const { data } = await api.post<{ plate_number: string; mismatch_type: string }>('/alerts', {
        plate_number: plate.trim(),
        ...(photo ? { plate_crop_jpeg: photo } : {}),
      });
      toast({
        title: `${data.plate_number}: ${mismatchLabel(data.mismatch_type)}`,
        status: data.mismatch_type === 'none' ? 'success' : 'warning',
      });
      onClose();
    } catch (e) {
      toast({ title: 'Plate not checked', description: apiMessage(e, 'Please try again'), status: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Scan a plate with this device</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {error ? (
            <Alert status="warning" borderRadius="md">
              <AlertIcon />
              {error}
            </Alert>
          ) : (
            <Box bg="gray.900" borderRadius="lg" overflow="hidden" position="relative" minH="200px">
              {hasPhoto ? (
                photoUrl && <img src={photoUrl} alt="Photo of the vehicle" style={{ width: '100%', display: 'block' }} />
              ) : (
                <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block' }} aria-label="Camera view" />
              )}
              {reading && (
                <HStack position="absolute" inset={0} justify="center" bg="blackAlpha.600" color="white">
                  <Spinner />
                  <Text>Reading the plate…</Text>
                </HStack>
              )}
            </Box>
          )}
          {!hasPhoto && !error && (
            <Text fontSize="sm" color="text.muted" mt={2}>
              Fill the frame with the plate, hold still, then take the photo. The first scan downloads
              the plate reader once (about 7 MB).
            </Text>
          )}
          {hasPhoto && (
            <FormControl mt={4}>
              <FormLabel htmlFor="scanned-plate">Plate</FormLabel>
              <Input
                id="scanned-plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                placeholder={reading ? 'Reading…' : 'Type the plate'}
                fontFamily="mono"
                fontSize="2xl"
                letterSpacing="wider"
                size="lg"
                isDisabled={reading}
              />
              <FormHelperText>Check it against the vehicle and correct it if needed.</FormHelperText>
            </FormControl>
          )}
        </ModalBody>
        <ModalFooter gap={3} flexWrap="wrap">
          {hasPhoto ? (
            <>
              <Button leftIcon={<FiRefreshCw />} onClick={startCamera} isDisabled={sending}>
                Retake
              </Button>
              <Button colorScheme="brand" onClick={check} isLoading={sending} isDisabled={reading || !plate.trim()}>
                Check plate
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onClose}>Cancel</Button>
              {error ? (
                <Button leftIcon={<FiRefreshCw />} onClick={startCamera}>
                  Try again
                </Button>
              ) : (
                <Button colorScheme="brand" leftIcon={<FiCamera />} onClick={takePhoto}>
                  Take photo
                </Button>
              )}
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default DeviceScanner;
