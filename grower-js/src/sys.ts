/**
 * st_mode field masks of stat structure.
 *
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/stat.2.html
 */
export enum StModeFileType {
    /** * File type and mode bits. */
    S_IFMT = 0o170000,
    /** Socket */
    S_IFSOCK = 0o140000,
    /** Symbolic link */
    S_IFLNK = 0o120000,
    /** Regular file */
    S_IFREG = 0o100000,
    /** Block device */
    S_IFBLK = 0o060000,
    /** Directory */
    S_IFDIR = 0o040000,
    /** Character device */
    S_IFCHR = 0o020000,
    /** FIFO */
    S_IFIFO = 0o010000,
}

/**
 * File descriptor reserved for standard input, output, and error.
 *
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/open.2.html
 */
export enum FdReserved {
    /** Standard input file descriptor */
    IN,
    /** Standard output file descriptor */
    OUT,
    /** Standard error file descriptor */
    ERR,
}

const OPFS_ROOT = "__grower_opfs_root";
const FDMAP = "__grower_fdmap";
const STDOUT_HANDLER = "__grower_stdout_handler";
const STDERR_HANDLER = "__grower_stderr_handler";
type _Window = Window & typeof globalThis & {
    [OPFS_ROOT]: FileSystemDirectoryHandle | undefined;
    [FDMAP]: Record<number, FileSystemHandle>;
    [STDOUT_HANDLER]: (text: string) => void;
    [STDERR_HANDLER]: (text: string) => void;
}

export const initSys = async (stdOut: (text: string) => void, stdErr: (text: string) => void): Promise<void> => {
    if (!(window as _Window)[OPFS_ROOT]) {
        const opfsRoot = await navigator.storage.getDirectory();
        (window as _Window)[OPFS_ROOT] = opfsRoot;
    }

    if (!(window as _Window)[FDMAP]) {
        (window as _Window)[FDMAP] = {};
    }

    (window as _Window)[STDOUT_HANDLER] = stdOut;
    (window as _Window)[STDERR_HANDLER] = stdErr;
}

/**
 * Checks the status of a file or directory at the given path.
 * @param path The path to the file or directory.
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/stat.2.html
 */
export const stat = async (path: string): Promise<number[]> => {
    const stat = {
        st_dev: 0, // Device ID
        st_ino: 0, // Inode number
        st_mode: 0, // File type and mode
        st_nlink: 1, // Number of hard links
        st_uid: 0, // User ID of owner
        st_gid: 0, // Group ID of owner
        st_rdev: 0, // Device ID (if special file)
        st_size: 0, // Size in bytes
        st_blksize: 4096, // Block size for filesystem I/O
        st_blocks: 0, // Number of blocks allocated
    };

    try {
        const fileHandle = await getFileHandle(getFileNameFromPath(path));
        if (!fileHandle) {
            return [-1];
        }

        const file = await (fileHandle as FileSystemFileHandle).getFile();
        stat.st_mode = StModeFileType.S_IFREG;
        stat.st_size = file.size ?? 0;

    } catch (e: unknown) {
        if ((e as Error).name === 'TypeMismatchError') {
            stat.st_mode = StModeFileType.S_IFDIR;
        } else if ((e as Error).name === 'NotFoundError') {
            return [-1];
        }
    }

    return Object.values(stat);
}

/**
 * Gets the file descriptor for the given path.
 * @param path The path to the file.
 * @return The file descriptor, or -1 if the file does not exist.
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/open.2.html
 */
export const open = async (path: string): Promise<number[]> => {
    const handle = await getFileHandle(path);

    if (!handle) {
        return [-1];
    }

    const result = Object.keys((window as _Window)[FDMAP]).length + 3;
    (window as _Window)[FDMAP][result] = handle;

    return [result];
}

/**
 * Closes the file descriptor.
 * @param fd The file descriptor to close.
 * @returns 0 on success, -1 on failure.
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/close.2.html
 */
export const close = (fd: number): number[] => {
    if (!(fd in (window as _Window)[FDMAP])) {
        return [-1]; // Invalid file descriptor
    }
    delete (window as _Window)[FDMAP][fd];
    return [0];
}

/**
 * Writes data to a file descriptor.
 * @param fd The file descriptor to write to.
 * @param b The data to write as a Uint8Array.
 * @param off The offset in the Uint8Array to start writing from.
 * @param len The number of bytes to write.
 * @return The number of bytes written, or 0 if the file descriptor is invalid.
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/write.2.html
 * */
export const write = async (fd: number, b: Uint8Array, off: number, len: number): Promise<number[]> => {
    const data = b.subarray(off, off + len);

    if (fd === FdReserved.OUT) {
        (window as _Window)[STDOUT_HANDLER](new TextDecoder().decode(data));
        return [data.length];
    } else if (fd === FdReserved.ERR) {
        (window as _Window)[STDERR_HANDLER](new TextDecoder().decode(data));
        return [data.length];
    }

// TODO
// const handle = (window as any)[FS_FDMAP][fd] as FileSystemFileHandle;
// const file = await handle.getFile();
// const data = Array.from(new Uint8Array(await file.arrayBuffer()));

    return [0];
}

/**
 * TODO
 *
 * Reads data from a file descriptor.
 * @param fd The file descriptor to read from.
 * @return A promise that resolves to a tuple containing the data as a Uint8Array and the number of bytes read.
 * @see https://manpages.ubuntu.com/manpages/focal/ja/man2/read.2.html
 * */
export const read = async (fd: number): Promise<[Uint8Array, number]> => {
    const handle = (window as any)[FDMAP][fd] as FileSystemFileHandle;
    const file = await handle.getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    return [data, data.length];
}

const getFileHandle = async (path: string): Promise<FileSystemHandle | undefined> => {
    if (!(window as _Window)[OPFS_ROOT]) {
        return undefined
    }

    const dirHandle = await getLastDirectory(path);
    if (!dirHandle) {
        return undefined;
    }

    return await dirHandle.getFileHandle(getFileNameFromPath(path));
}

const getLastDirectory = async (path: string): Promise<FileSystemDirectoryHandle | undefined> => {
    const dirs = path.startsWith("/")
        ? path.substring(1).split("/").slice(0, -1)
        : path.split("/").slice(0, -1);
    if (dirs.length === 0) {
        return (window as _Window)[OPFS_ROOT];
    }

    let parentDir = (window as _Window)[OPFS_ROOT] as FileSystemDirectoryHandle;
    for (let dir of dirs) {
        try {
            parentDir = await parentDir.getDirectoryHandle(dir);
        } catch (e: unknown) {
            return undefined;
        }
    }

    return parentDir;
}

const getFileNameFromPath = (path: string): string => {
    return path.split("/").pop()!;
}