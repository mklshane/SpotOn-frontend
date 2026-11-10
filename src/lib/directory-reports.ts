/**
 * "Report incorrect info" - sends a patient's correction to POST /directory/reports (server 019),
 * where it is reviewed in SpotOn-admin.
 *
 * Offline-first like the rest of the directory: when the request can't reach the server (no
 * connection, timeout) the report is kept in sync_meta under this account's key and sent after the
 * next successful directory sync (flushPendingReports). A server rejection (4xx) is NOT queued -
 * resending the same invalid report forever would never succeed.
 */
import Constants from "expo-constants";

import { ApiError, api } from "../api/client";
import { getMeta, setMeta } from "../data/db";
import { accountStorageKey, getActiveAccountId } from "./account-scope";

export const REPORT_CATEGORIES = [
  "wrong_phone",
  "wrong_address",
  "wrong_schedule",
  "doctor_not_here",
  "closed_or_moved",
  "not_dermatology",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export interface DirectoryReportInput {
  target_kind: "facility" | "doctor";
  target_id: string;
  category: ReportCategory;
  message?: string | null;
}

export type SubmitResult = "sent" | "queued";

const QUEUE_KEY = "pending_directory_reports";
const MAX_QUEUED = 20;

const appVersion = (): string | null => Constants.expoConfig?.version ?? null;

/**
 * A failure worth retrying later: no response at all, or a server error. A 4xx (including 429,
 * too many reports this hour) is the server's answer and is shown to the user instead.
 */
function isTransient(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  return true; // fetch threw: offline, DNS, "timed out"
}

async function readQueue(userId: string): Promise<DirectoryReportInput[]> {
  try {
    const raw = await getMeta(accountStorageKey(userId, QUEUE_KEY));
    const parsed = raw ? (JSON.parse(raw) as DirectoryReportInput[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(userId: string, items: DirectoryReportInput[]): Promise<void> {
  await setMeta(accountStorageKey(userId, QUEUE_KEY), JSON.stringify(items.slice(-MAX_QUEUED)));
}

async function send(report: DirectoryReportInput): Promise<void> {
  await api.post("/directory/reports", {
    ...report,
    message: report.message?.trim() || null,
    app_version: appVersion(),
  });
}

/**
 * Send a report now, or queue it when the server can't be reached. Throws on a server rejection
 * (ApiError 4xx, e.g. 429 too many reports) and when signed out.
 */
export async function submitDirectoryReport(report: DirectoryReportInput): Promise<SubmitResult> {
  const userId = getActiveAccountId();
  if (!userId) throw new Error("Sign in to send a report");
  try {
    await send(report);
    return "sent";
  } catch (e) {
    if (!isTransient(e)) throw e;
    await writeQueue(userId, [...(await readQueue(userId)), report]);
    return "queued";
  }
}

/** Send any reports queued while offline. Stops at the first transient failure; drops rejected ones. */
export async function flushPendingReports(): Promise<number> {
  const userId = getActiveAccountId();
  if (!userId) return 0;
  const queue = await readQueue(userId);
  if (!queue.length) return 0;
  let sent = 0;
  const left: DirectoryReportInput[] = [];
  for (let i = 0; i < queue.length; i++) {
    try {
      await send(queue[i]);
      sent++;
    } catch (e) {
      if (isTransient(e)) {
        left.push(...queue.slice(i));
        break;
      }
      // Rejected by the server (deleted listing, validation): resending can't succeed.
    }
  }
  await writeQueue(userId, left);
  return sent;
}
