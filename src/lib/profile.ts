import { api } from "@/api/client";
import type { Sex, UserProfile } from "@/api/types";

export function fetchProfile(): Promise<UserProfile> {
  return api.get<UserProfile>("/me", undefined, true);
}

/** A profile counts as complete once a date of birth has been recorded. */
export function isProfileComplete(user: UserProfile): boolean {
  return user.date_of_birth != null;
}

export type ProfileInput = {
  fullName?: string;
  dateOfBirth: string; // ISO "YYYY-MM-DD"
  sex: Sex;
  phone?: string;
  fitzpatrickSkinType?: number; // 1-6
  /**
   * `undefined` — not touched, leave the stored avatar as-is.
   * `null` — the user removed their photo, clear it.
   * `string` — a new local file URI (from the image picker) to upload.
   */
  avatarUri?: string | null;
};

export type SaveProfileResult = {
  /** Server-authoritative profile, re-fetched after all PATCH attempts — never assembled from local input. */
  user: UserProfile;
  /** Field names (matching the API's snake_case) that failed to save, if any. */
  failedFields: string[];
};

/**
 * Uploads a local image file to the backend as the user's avatar.
 *
 * ASSUMPTION — I don't have `api/client.ts`, so this assumes:
 *   1. `api` exposes a `post` method that accepts a `FormData` body (multipart).
 *   2. There's a `POST /me/avatar` endpoint accepting a `file` field and
 *      updating the user's avatar server-side.
 * Adjust the method name / endpoint / field name to match your actual API
 * client and backend route once those exist.
 */
async function uploadAvatar(localUri: string): Promise<void> {
  const filename = localUri.split("/").pop() ?? `avatar-${Date.now()}.jpg`;
  const extension = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase();
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";

  const formData = new FormData();
  // React Native's FormData accepts this `{ uri, name, type }` shape for file
  // fields; it isn't a real `Blob` at the type level, hence the cast.
  formData.append("file", {
    uri: localUri,
    name: filename,
    type: mimeType,
  } as unknown as Blob);

  await api.post("/me/avatar", formData);
}

export async function saveProfile({
  fullName,
  dateOfBirth,
  sex,
  phone,
  fitzpatrickSkinType,
  avatarUri,
}: ProfileInput): Promise<SaveProfileResult> {
  const failedFields: string[] = [];

  // DOB + sex are accepted by the deployed API today.
  await api.patch("/me", { date_of_birth: dateOfBirth, sex });

  // Each of the following isolates its own PATCH so a 404/422 on one field
  // (e.g. before the backend redeploys with that field) doesn't fail the others.
  const trimmedName = fullName?.trim();
  if (trimmedName) {
    try {
      await api.patch("/me", { full_name: trimmedName });
    } catch {
      failedFields.push("full_name");
    }
  }

  const trimmedPhone = phone?.trim();
  if (trimmedPhone) {
    try {
      await api.patch("/me", { phone: trimmedPhone });
    } catch {
      failedFields.push("phone");
    }
  }

  if (fitzpatrickSkinType != null) {
    try {
      await api.patch("/me", { fitzpatrick_skin_type: fitzpatrickSkinType });
    } catch {
      failedFields.push("fitzpatrick_skin_type");
    }
  }

  if (avatarUri === null) {
    try {
      await api.patch("/me", { avatar_url: null });
    } catch {
      failedFields.push("avatar_url");
    }
  } else if (avatarUri) {
    try {
      await uploadAvatar(avatarUri);
    } catch {
      failedFields.push("avatar_url");
    }
  }

  const user = await fetchProfile();
  return { user, failedFields };
}

/**
 * Where an authenticated user should land: the profile step if incomplete, else
 * the app. Defaults to the app on network error so offline users aren't blocked.
 */
export async function routeAfterAuth(): Promise<
  "/(auth)/complete-profile" | "/home"
> {
  try {
    const me = await fetchProfile();
    return isProfileComplete(me) ? "/home" : "/(auth)/complete-profile";
  } catch {
    return "/home";
  }
}
