import EventSource from 'eventsource';
import { config } from '../config.js';
import { getTaskContainer, getActiveContainers, getContainer } from '../db/index.js';
import { notifyComplete, notifyBlocked, notifyCanceled, notifyEmergencyStop } from './telegram.js';

interface SsePayload {
  type: string;
  taskId?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

let state: ConnectionState = 'connecting';
let reconnectCount = 0;
let lastConnectedAt: string | null = null;
let lastErrorAt: string | null = null;

export interface SseStatus {
  connected: boolean;
  reconnectAttempts: number;
  state: ConnectionState;
  lastConnectedAt: string | null;
  lastErrorAt: string | null;
  uptimeMs: number | null;
}

export function getSseStatus(): SseStatus {
  const uptimeMs =
    state === 'connected' && lastConnectedAt !== null
      ? Date.now() - new Date(lastConnectedAt).getTime()
      : null;

  return {
    connected: state === 'connected',
    reconnectAttempts: reconnectCount,
    state,
    lastConnectedAt,
    lastErrorAt,
    uptimeMs,
  };
}

export function handleEvent(eventType: string, data: string): void {
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
    console.log(`[sse] Emergency stop — notifying ${containers.length} active container(s)`);
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

  console.log(`[sse] ${eventType} for task ${taskId} → container ${container.container_id} (${container.project_name})`);

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
  state = 'connecting';
  reconnectCount = 0;

  es.onopen = () => {
    const now = new Date().toISOString();
    lastConnectedAt = now;
    if (state === 'reconnecting') {
      console.log(`[sse][${now}] Connected (reconnect #${reconnectCount})`);
    } else {
      console.log(`[sse][${now}] Connected`);
    }
    state = 'connected';
    reconnectCount = 0;
  };

  es.onerror = (err: unknown) => {
    const now = new Date().toISOString();
    lastErrorAt = now;
    if (state === 'connected') {
      state = 'reconnecting';
      reconnectCount = 1;
    } else {
      reconnectCount += 1;
    }
    console.error(`[sse][${now}] Disconnected (reconnect #${reconnectCount})`, err);
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
