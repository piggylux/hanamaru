/**
 * Parts of the File System Access API that Chrome and Edge ship but TypeScript's own types don't
 * describe yet: asking to read a folder again, and the folder picker.
 */
type FileSystemPermissionMode = 'read' | 'readwrite';

interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: {
    /** Remembers the last folder picked under this id, and opens there next time */
    id?: string;
    mode?: FileSystemPermissionMode;
  }): Promise<FileSystemDirectoryHandle>;
}
