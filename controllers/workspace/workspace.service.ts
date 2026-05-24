import type { SavedWorkspaceFile, WorkspaceFileEntry } from "../../common/services/workspace-files.js";
import {
  listWorkspaceFiles,
  saveWorkspaceFile,
} from "../../common/services/workspace-files.js";

export class WorkspaceService {
  async uploadFile(
    sessionId: string,
    buffer: Buffer,
    originalName: string,
    relativePath?: string,
  ): Promise<SavedWorkspaceFile> {
    return saveWorkspaceFile(sessionId, buffer, { originalName, relativePath });
  }

  async listUploads(sessionId: string): Promise<WorkspaceFileEntry[]> {
    return listWorkspaceFiles(sessionId);
  }
}
