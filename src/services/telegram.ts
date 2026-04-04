import { ContainerRow } from '../db.js';

export async function sendNotification(botToken: string, chatId: string, message: string): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error(`[telegram] sendMessage failed: ${response.status} ${body}`);
    }
  } catch (err) {
    console.error('[telegram] sendNotification error:', err);
  }
}

export async function notifyComplete(container: ContainerRow, taskId: string): Promise<void> {
  const msg = `✅ ${container.project_name} — RELEASE READY | Task: ${taskId}`;
  await sendNotification(container.telegram_bot_token, container.telegram_chat_id, msg);
}

export async function notifyBlocked(container: ContainerRow, taskId: string, gate: string, reason: string): Promise<void> {
  const msg = `🚫 ${container.project_name} — BLOCKED: ${gate} — ${reason} | Task: ${taskId}`;
  await sendNotification(container.telegram_bot_token, container.telegram_chat_id, msg);
}

export async function notifyCanceled(container: ContainerRow, taskId: string): Promise<void> {
  const msg = `⛔ ${container.project_name} — CANCELED | Task: ${taskId}`;
  await sendNotification(container.telegram_bot_token, container.telegram_chat_id, msg);
}

export async function notifyEmergencyStop(containers: ContainerRow[]): Promise<void> {
  const msg = `🛑 ALL RUNS STOPPED — emergency stop activated`;
  await Promise.all(
    containers.map((c) => sendNotification(c.telegram_bot_token, c.telegram_chat_id, msg))
  );
}
