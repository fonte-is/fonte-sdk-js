import { constants } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  BroadcastRequestStore,
  SavedBroadcastRequest,
} from "./broadcast-contracts.js";
import { CoreOperatorError } from "./operator-core-request.js";
import { parseBroadcastSendReceipt } from "./broadcast-receipts.js";
import {
  BROADCAST_CONTROL_BYTES,
  broadcastUuid,
  canonicalBroadcastInput,
  parseSavedBroadcastRequest,
  sameBroadcastInput,
} from "./broadcast-validation.js";

/** Immutable reference-only input; atomic publication plus fsync precedes every effectful POST.
 * Neither bearer tokens, recipient lists, message bodies nor commercial policy are stored. */
export function createBroadcastFileStore(
  directory: string,
): BroadcastRequestStore {
  function path(requestId: string, suffix = ""): string {
    if (!broadcastUuid.safeParse(requestId).success)
      fail("broadcast_request_invalid");
    return join(directory, `${requestId}${suffix}.json`);
  }
  async function read(requestId: string): Promise<SavedBroadcastRequest> {
    let file;
    try {
      file = await open(
        path(requestId),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch {
      fail("broadcast_saved_input_recover_review_required");
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > BROADCAST_CONTROL_BYTES)
        fail("broadcast_saved_input_recover_review_required");
      const value = parseSavedBroadcastRequest(
        JSON.parse(await file.readFile("utf8")),
      );
      if (value.request.requestId !== requestId)
        fail("broadcast_saved_input_recover_review_required");
      return value;
    } catch {
      fail("broadcast_saved_input_recover_review_required");
    } finally {
      await file.close();
    }
  }
  return {
    read,
    async readSuperseded(requestId) {
      const saved = await read(requestId);
      let file;
      try {
        file = await open(
          path(requestId, ".superseded"),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
      } catch (error) {
        if (hasCode(error, "ENOENT")) return null;
        fail("broadcast_saved_input_recover_review_required");
      }
      try {
        if ((await file.stat()).size > BROADCAST_CONTROL_BYTES)
          fail("broadcast_saved_input_recover_review_required");
        const receipt = parseBroadcastSendReceipt(
          JSON.parse(await file.readFile("utf8")),
          saved.coreOrigin,
          "none",
          saved,
        );
        if (
          receipt.outcome !== "rejected" ||
          receipt.blocker?.code !== "request_superseded"
        )
          fail("broadcast_saved_input_recover_review_required");
        return receipt;
      } catch {
        fail("broadcast_saved_input_recover_review_required");
      } finally {
        await file.close();
      }
    },
    async rememberSuperseded(requestId, input) {
      const saved = await read(requestId);
      const receipt = parseBroadcastSendReceipt(
        input,
        saved.coreOrigin,
        "none",
        saved,
      );
      if (
        receipt.outcome !== "rejected" ||
        receipt.blocker?.code !== "request_superseded"
      )
        fail("broadcast_request_invalid");
      await publish(path(requestId, ".superseded"), JSON.stringify(receipt));
    },
    async persist(input) {
      const checked = parseSavedBroadcastRequest(input);
      const target = path(checked.request.requestId);
      await publish(target, canonicalBroadcastInput(checked));
      const stored = await read(checked.request.requestId);
      if (!sameBroadcastInput(stored, checked))
        fail("broadcast_request_conflict");
      return stored;
    },
  };
  async function publish(target: string, serialized: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(serialized);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      try {
        await link(temporary, target);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      const directoryHandle = await open(directory, constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
function hasCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}
function fail(reason: string): never {
  throw new CoreOperatorError(reason, null, "none");
}
