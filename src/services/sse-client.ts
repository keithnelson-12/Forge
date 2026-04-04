import EventSource from 'eventsource';
import { config } from '../config.js';
import { getTaskContainer, getActiveContainers, getContainer } from '../db.js';
import { notifyComplete, notifyBlocked, notifyCanceled, notifyEmergencyStop } from './telegram.js';

interface SsePayload {
  type: string;
  taskId?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

function handleEvent(eventType: string, data: string): void {
  let parsed: SsePayload;
  try {
    parsed = JSON.parse(data) as SsePayload;
  } catch {
    console.error(`[sse] Failed to parse event data for ${eventType}:`, data);
    return;
  }

  const taskId = parsed.taskId;

  if (eventType === 'orchestrator:emergency_stop') {
    const containers = getActiveContainers();
    notifyEmergencyStop(containers).catch((err) =>
      console.error('[sse] notifyEmergencyStop error:', err)
    );
    return;
  }

  if (!taskId) {
    console.warn(`[sse] Event ${eventType} has no taskId, skipping`);
    return;
  }

  const mapping = getTaskContainer(taskId);
  if (!mapping) {
    console.log(`[sse] No mapping for taskId ${taskId} — task not submitted via Forge, skipping`);
    return;
  }

  const container = getContainer(mapping.container_id);
  if (!container) {
    console.warn(`[sse] Container ${mapping.container_id} not found for taskId ${taskId}`);
    return;
  }

  if (eventType === 'task:completed') {
    notifyComplete(container, taskId).catch((err) =>
      console.error('[sse] notifyComplete error:', err)
    );
  } else if (eventType === 'task:failed') {
    const p = parsed.payload ?? {};
    const gate = String(p['gate'] ?? 'unknown');
    const reason = String(p['reason'] ?? p['message'] ?? 'no details');
    notifyBlocked(container, taskId, gate, reason).catch((err) =>
      console.error('[sse] notifyBlocked error:', err)
    );
  } else if (eventType === 'task:canceled') {
    notifyCanceled(container, taskId).catch((err) =>
      console.error('[sse] notifyCanceled error:', err)
    );
  }
}

export function connectToHarness(): void {
  const url = `${config.harnessUrl}/v1/events/stream`;
  console.log(`[sse] Connecting to harness SSE at ${url}`);

  const es = new EventSource(url);

  es.onopen = () => {
    console.log('[sse] Connected to harness event stream');
  };

  es.onerror = (err) => {
    console.error('[sse] SSE connection error (will auto-reconnect):', err);
  };

  const trackedEvents = ['task:completed', 'task:failed', 'task:canceled', 'orchestrator:emergency_stop'];

  for (const eventType of trackedEvents) {
    es.addEventListener(eventType, (event: MessageEvent) => {
      handleEvent(eventType, event.data as string);
    });
  }

  // Also handle generic message events that carry type in the data
  es.onmessage = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data as string) as SsePayload;
      if (parsed.type && trackedEvents.includes(parsed.type)) {
        handleEvent(parsed.type, event.data as string);
      }
    } catch {
      // Not JSON, ignore
    }
  };
}
